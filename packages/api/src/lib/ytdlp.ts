import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const SNATCH_DIR = process.env.YTDLP_DIR || path.join(os.homedir(), ".snatch", "bin");
const RELEASE_BASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

const INFO_JSON_PREFIX = "snatch-info-"; // ponytail: stale probe jsons rely on explicit rm after download + OS tmp cleanup; no background sweep

function ytDlpAssetName(): string {
	if (process.platform === "win32") return "yt-dlp.exe";
	if (process.platform === "darwin") return "yt-dlp_macos";
	return process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
}

function commandWorks(cmd: string, args: string[]): Promise<boolean> {
	const { promise, resolve } = Promise.withResolvers<boolean>();
	let child: ChildProcess;
	try {
		child = spawn(cmd, args, { stdio: "ignore", timeout: 10_000 });
	} catch {
		return Promise.resolve(false);
	}
	child.on("error", () => resolve(false));
	child.on("close", (code) => resolve(code === 0));
	return promise;
}

/**
 * Resolve a usable yt-dlp binary: system install first, then cached download,
 * then fetch standalone binary from GitHub releases.
 */
export async function ensureYtDlp(signal?: AbortSignal): Promise<string> {
	if (await commandWorks("yt-dlp", ["--version"])) return "yt-dlp";

	const local = path.join(SNATCH_DIR, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
	if (await commandWorks(local, ["--version"])) return local;

	await fs.mkdir(SNATCH_DIR, { recursive: true });

	const url = `${RELEASE_BASE}/${ytDlpAssetName()}`;
	const response = await fetch(url, { signal });
	if (!response.ok || !response.body) {
		throw new Error(`Could not download yt-dlp (${response.status}). Check network connection.`);
	}

	const tmp = `${local}.download`;
	await pipeline(
		Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
		createWriteStream(tmp),
		{ signal },
	);
	await fs.chmod(tmp, 0o755);
	await fs.rename(tmp, local);
	return local;
}

interface RawFormat {
	format_id: string;
	ext?: string;
	vcodec?: string;
	acodec?: string;
	height?: number;
	width?: number;
	abr?: number;
	tbr?: number;
	filesize?: number;
	filesize_approx?: number;
}

export interface VideoInfo {
	id: string;
	title: string;
	uploader?: string;
	duration?: number;
	thumbnail?: string;
	webpage_url?: string;
	extractor_key?: string;
	formats?: RawFormat[];
}

function isRawFormat(value: unknown): value is RawFormat {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as RawFormat).format_id === "string"
	);
}

/** Parse and shape-validate untrusted yt-dlp JSON into a VideoInfo. */
export function parseVideoInfo(raw: string): VideoInfo {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		throw new Error("Could not parse video metadata from yt-dlp.");
	}
	if (typeof data !== "object" || data === null) {
		throw new Error("Unexpected video metadata shape from yt-dlp.");
	}
	const obj = data as Record<string, unknown>;
	return {
		id: typeof obj.id === "string" ? obj.id : "",
		title: typeof obj.title === "string" ? obj.title : "",
		uploader: typeof obj.uploader === "string" ? obj.uploader : undefined,
		duration: typeof obj.duration === "number" ? obj.duration : undefined,
		thumbnail: typeof obj.thumbnail === "string" ? obj.thumbnail : undefined,
		webpage_url: typeof obj.webpage_url === "string" ? obj.webpage_url : undefined,
		extractor_key: typeof obj.extractor_key === "string" ? obj.extractor_key : undefined,
		formats: Array.isArray(obj.formats) ? obj.formats.filter(isRawFormat) : undefined,
	};
}

interface ProbeResult {
	info: VideoInfo;
	infoJsonPath: string;
}

interface DownloadChoice {
	id: string;
	label: string;
	kind: "video" | "audio";
	quality?: string;
	ext: string;
	args: string[];
	sizeLabel?: string;
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

export async function probe(
	ytdlp: string,
	url: string,
	signal?: AbortSignal,
): Promise<ProbeResult> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const child = spawn(ytdlp, ["-J", "--no-playlist", "--no-warnings", url], { signal });
	let out = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => {
		out += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	child.on("error", reject);
	child.on("close", (code) => {
		if (code !== 0) {
			reject(new Error(cleanYtDlpError(stderr) || `yt-dlp probe failed (exit code ${code})`));
		} else {
			resolve(out);
		}
	});

	const stdout = await promise;
	const info = parseVideoInfo(stdout);

	const infoJsonPath = path.join(
		os.tmpdir(),
		`${INFO_JSON_PREFIX}${process.pid}-${Date.now()}.json`,
	);
	await fs.writeFile(infoJsonPath, stdout);
	return { info, infoJsonPath };
}

const MAX_VIDEO_CHOICES = 8;

export function buildChoices(info: VideoInfo): DownloadChoice[] {
	const formats = info.formats ?? [];
	const choices: DownloadChoice[] = [];

	const audioOnly = formats.filter(
		(f) => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"),
	);
	const bestAudio = [...audioOnly].sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))[0];
	const audioSize = bestAudio?.filesize ?? bestAudio?.filesize_approx;

	const videos = formats.filter((f) => f.vcodec && f.vcodec !== "none" && f.height);
	const heights = [...new Set(videos.map((f) => f.height as number))].sort((a, b) => b - a);

	for (const height of heights.slice(0, MAX_VIDEO_CHOICES)) {
		const candidates = videos.filter((f) => f.height === height);
		const best = [...candidates].sort((a, b) => scoreVideo(b) - scoreVideo(a))[0];
		const muxed = best.acodec && best.acodec !== "none";
		const size = (best.filesize ?? best.filesize_approx ?? 0) + (muxed ? 0 : (audioSize ?? 0));
		const sizeLabel = size > 0 ? formatBytes(size) : undefined;
		const ext = "mp4";

		choices.push({
			id: `v-${height}p`,
			kind: "video",
			quality: `${height}p`,
			ext,
			label: `${height}p · ${ext}${sizeLabel ? ` · ~${sizeLabel}` : ""}`,
			sizeLabel,
			args: [
				"-f",
				`bv*[height=${height}]+ba/b[height=${height}]/bv*[height<=${height}]+ba/b`,
				"--merge-output-format",
				"mp4",
			],
		});
	}

	if (choices.length === 0) {
		choices.push({
			id: "v-best",
			kind: "video",
			quality: "best",
			ext: "mp4",
			label: "best available · mp4",
			args: ["-f", "bv*+ba/b", "--merge-output-format", "mp4"],
		});
	}

	const audioSizeLabel = audioSize ? formatBytes(audioSize) : undefined;
	choices.push({
		id: "a-mp3",
		kind: "audio",
		quality: "mp3",
		ext: "mp3",
		label: `audio only · mp3${audioSizeLabel ? ` · ~${audioSizeLabel}` : ""}`,
		sizeLabel: audioSizeLabel,
		args: ["-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", "0"],
	});

	return choices;
}
function scoreVideo(f: RawFormat): number {
	let score = f.tbr ?? 0;
	if (f.ext === "mp4") score += 10_000;
	if (f.vcodec?.startsWith("avc")) score += 5_000;
	return score;
}

interface ExecuteDownloadOptions {
	ytdlp: string;
	url: string;
	infoJsonPath?: string;
	args: string[];
}

export type DownloadProgressEvent = {
	kind: "progress";
	downloadedBytes: number;
	totalBytes?: number;
	speed?: number;
	eta?: number;
	part: number;
	totalParts: number;
};

export type DownloadProcessingEvent = {
	kind: "processing";
};

export type DownloadEvent = DownloadProgressEvent | DownloadProcessingEvent;

const PROGRESS_PREFIX = "YOINK|";
const PROGRESS_TEMPLATE = `${PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`;

/**
 * Stream yt-dlp download events and return the final file path. Mirrors yoinks'
 * progress parsing: live bytes/speed/ETA while downloading, processing events
 * during merge/audio extraction, and the resolved filepath once complete.
 */
export async function* downloadWithProgress(
	opts: ExecuteDownloadOptions,
	signal?: AbortSignal,
): AsyncGenerator<DownloadEvent, { filePath: string; cleanup: () => Promise<void> }> {
	const outDir = os.tmpdir();
	const outPattern = path.join(outDir, `snatch-${Date.now()}-%(title).60s.%(ext)s`);
	const args = [
		...(opts.infoJsonPath ? ["--load-info-json", opts.infoJsonPath] : [opts.url]),
		...opts.args,
		"--no-playlist",
		"--no-warnings",
		"--newline",
		"--no-quiet",
		"--progress",
		"--progress-template",
		`download:${PROGRESS_TEMPLATE}`,
		"--print",
		"after_move:filepath",
		"--no-simulate",
		"-o",
		outPattern,
	];

	const { promise, resolve, reject } = Promise.withResolvers<{
		filePath: string;
		cleanup: () => Promise<void>;
	}>();
	const child = spawn(opts.ytdlp, args, { signal });
	let stderr = "";
	let filepath = "";
	let completed = false;
	let part = 0;
	let totalParts = 1;
	let lastDownloaded = 0;
	let buffer = "";
	const destinations: string[] = [];

	const eventQueue: DownloadEvent[] = [];
	let eventResolver: ((value?: unknown) => void) | undefined;

	function pushEvent(event: DownloadEvent) {
		eventQueue.push(event);
		eventResolver?.();
		eventResolver = undefined;
	}

	child.stdout.on("data", (chunk: Buffer) => {
		buffer += chunk.toString();
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line) continue;
			if (line.startsWith(PROGRESS_PREFIX)) {
				const [downloaded, total, totalEstimate, speed, eta] = line
					.slice(PROGRESS_PREFIX.length)
					.split("|");
				const downloadedBytes = toNumber(downloaded) ?? 0;
				if (downloadedBytes < lastDownloaded) part++;
				lastDownloaded = downloadedBytes;
				pushEvent({
					kind: "progress",
					downloadedBytes,
					totalBytes: toNumber(total) ?? toNumber(totalEstimate),
					speed: toNumber(speed),
					eta: toNumber(eta),
					part,
					totalParts,
				});
			} else if (line.includes("Downloading 1 format(s):")) {
				totalParts = (line.split("format(s):")[1] ?? "").trim().split("+").length;
			} else if (line.includes("[Merger]") || line.includes("[ExtractAudio]")) {
				const merging = /^\[Merger\] Merging formats into "(.+)"$/.exec(line)?.[1];
				const extracting = /^\[ExtractAudio\] Destination: (.+)$/.exec(line)?.[1];
				const target = merging ?? extracting;
				if (target) destinations.push(target);
				pushEvent({ kind: "processing" });
			} else if (line.startsWith("[download] Destination: ")) {
				destinations.push(line.slice("[download] Destination: ".length));
			} else if (path.isAbsolute(line)) {
				filepath = line;
			}
		}
	});

	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});

	child.on("error", reject);
	child.on("close", (code) => {
		if (signal?.aborted) {
			void removeFiles(destinations);
			reject(new Error("Download cancelled."));
			return;
		}
		if (code === 0 && filepath) {
			completed = true;
			const cleanup = async () => {
				const filesToRemove = [filepath, ...destinations];
				await removeFiles(filesToRemove);
			};
			resolve({ filePath: filepath, cleanup });
		} else {
			void removeFiles(destinations);
			reject(new Error(cleanYtDlpError(stderr) || `Download failed (exit code ${code}).`));
		}
	});

	try {
		while (true) {
			if (eventQueue.length > 0) {
				const event = eventQueue.shift();
				if (event) {
					yield event;
					continue;
				}
			}
			await new Promise<unknown>((resolveWait) => {
				eventResolver = resolveWait;
				// also resolve when the process promise settles so we can return
				void promise.then(resolveWait, resolveWait);
			});
			if (eventQueue.length === 0) break;
		}
		return await promise;
	} finally {
		// only kill+clean if the consumer abandoned the generator early
		if (!completed && !child.killed) {
			child.kill("SIGTERM");
			void removeFiles(destinations);
		}
	}
}

/**
 * Wait for a download to finish without observing progress events.
 */
export async function executeDownload(
	opts: ExecuteDownloadOptions,
	signal?: AbortSignal,
): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
	const events = downloadWithProgress(opts, signal);
	let result = await events.next();
	while (!result.done) {
		result = await events.next();
	}
	if (!result.value) throw new Error("Download completed without producing a file path.");
	return result.value;
}

function toNumber(value: string | undefined): number | undefined {
	if (!value || value === "NA" || value === "None") return undefined;
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? n : undefined;
}

function removeFiles(files: string[]): Promise<unknown> {
	const set = new Set(files.flatMap((f) => [f, `${f}.part`, `${f}.ytdl`]));
	return Promise.allSettled(Array.from(set).map((file) => fs.rm(file, { force: true })));
}

function cleanYtDlpError(stderr: string): string {
	const lines = stderr
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.startsWith("ERROR:"));
	const last = lines.at(-1);
	return last ? last.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, "") : stderr.trim();
}
