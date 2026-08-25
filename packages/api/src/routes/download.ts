import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { type ResolveResponse, validateUrl } from "@snatch/shared";
import { type Context, Hono } from "hono";
import { stream } from "hono/streaming";
import { sanitizeFilename, signUrl, verifyUrl } from "../lib/security";
import {
	buildChoices,
	type DownloadEvent,
	downloadWithProgress,
	ensureYtDlp,
	parseVideoInfo,
	probe,
	type VideoInfo,
} from "../lib/ytdlp";
import { resolveInputSchema } from "../schemas/media";

const downloadRouter = new Hono();

interface ProgressParams {
	url: string;
	choiceId: string;
	infoJson: string;
}

interface FileParams {
	file: string;
}

/** Canonical, signature-covered payload for the progress endpoint. */
function progressPayload(p: ProgressParams): string {
	return JSON.stringify([p.url, p.choiceId, p.infoJson]);
}

/** Canonical, signature-covered payload for the file-delivery endpoint. */
function filePayload(p: FileParams): string {
	return JSON.stringify([p.file]);
}

function generateProgressUrl(
	params: ProgressParams,
	filename: string,
	origin: string,
	c: Context,
): string {
	const sig = signUrl(progressPayload(params), c);
	const query = new URLSearchParams({
		url: params.url,
		choiceId: params.choiceId,
		infoJson: params.infoJson,
		filename,
		sig,
	});
	return `${origin}/api/download/progress?${query.toString()}`;
}

function generateFileUrl(filePath: string, origin: string, c: Context): string {
	const sig = signUrl(filePayload({ file: filePath }), c);
	const query = new URLSearchParams({ file: filePath, sig });
	return `${origin}/api/download?${query.toString()}`;
}

/**
 * POST /api/resolve
 * Resolve media URL formats using yt-dlp.
 */
downloadRouter.post("/api/resolve", async (c) => {
	let raw: unknown;
	try {
		raw = await c.req.json();
	} catch {
		return c.json({ success: false, error: "Invalid JSON in request body" }, 400);
	}

	const parsed = resolveInputSchema.safeParse(raw);
	if (!parsed.success) {
		return c.json(
			{ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" },
			400,
		);
	}

	const { url } = parsed.data;

	try {
		const ytdlp = await ensureYtDlp(c.req.raw.signal);
		const { info, infoJsonPath } = await probe(ytdlp, url, c.req.raw.signal);
		const choices = buildChoices(info);
		const origin = new URL(c.req.url).origin;
		const titleBase = (info.title || "media").slice(0, 50);

		const picker = choices.map((choice) => ({
			id: choice.id,
			type: choice.kind,
			quality: choice.quality,
			ext: choice.ext,
			label: choice.label,
			url: generateProgressUrl(
				{
					url,
					choiceId: choice.id,
					infoJson: infoJsonPath,
				},
				`${titleBase}.${choice.ext}`,
				origin,
				c,
			),
			thumb: info.thumbnail,
		}));

		const response: ResolveResponse = {
			status: "picker",
			title: info.title,
			thumbnail: info.thumbnail,
			duration: info.duration,
			filename: `${titleBase}.mp4`,
			picker,
		};

		return c.json(response);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Resolution failed";
		return c.json(
			{
				status: "error",
				error: { code: "api.resolve_failed", message: msg },
			},
			200,
		);
	}
});

/**
 * GET /api/download/progress
 * Server-sent events endpoint that runs yt-dlp for the selected format and
 * streams live progress. Once the file is ready, it emits a `ready` event
 * carrying a signed URL to the byte-delivery route. This mirrors yoinks'
 * probing → picking → downloading → done flow in the browser.
 */
downloadRouter.get("/api/download/progress", async (c) => {
	const url = c.req.query("url");
	const choiceId = c.req.query("choiceId");
	const infoJsonPath = c.req.query("infoJson");
	const signature = c.req.query("sig");
	const requestedFilename = c.req.query("filename");

	if (!url || !choiceId || !infoJsonPath || !signature) {
		return c.json({ success: false, error: "Missing required download parameters" }, 400);
	}

	const validation = validateUrl(url);
	if (!validation.valid) {
		return c.json({ success: false, error: validation.error }, 400);
	}

	if (!verifyUrl(progressPayload({ url, choiceId, infoJson: infoJsonPath }), signature, c)) {
		return c.json({ success: false, error: "Invalid download signature" }, 403);
	}

	c.header("Content-Type", "text/event-stream");
	c.header("Cache-Control", "no-cache");
	c.header("Connection", "keep-alive");

	return stream(c, async (s) => {
		const send = (event: string, data: Record<string, unknown>) => {
			void s.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
		};

		try {
			const ytdlp = await ensureYtDlp(c.req.raw.signal);

			let info: VideoInfo | undefined;
			let infoJsonToUse = infoJsonPath;
			try {
				info = parseVideoInfo(await fs.readFile(infoJsonPath, "utf-8"));
			} catch {
				const probed = await probe(ytdlp, url, c.req.raw.signal);
				info = probed.info;
				infoJsonToUse = probed.infoJsonPath;
			}

			const choices = buildChoices(info);
			const selectedChoice = choices.find((ch) => ch.id === choiceId);
			if (!selectedChoice) {
				send("failed", { message: "Requested format is no longer available" });
				return;
			}

			const events = downloadWithProgress(
				{
					ytdlp,
					url,
					infoJsonPath: infoJsonToUse,
					args: selectedChoice.args,
				},
				c.req.raw.signal,
			);

			let result = await events.next();
			while (!result.done) {
				const event = result.value as DownloadEvent;
				if (event.kind === "progress") {
					send("progress", {
						downloadedBytes: event.downloadedBytes,
						totalBytes: event.totalBytes,
						speed: event.speed,
						eta: event.eta,
						part: event.part,
						totalParts: event.totalParts,
					});
				} else if (event.kind === "processing") {
					send("processing", {});
				}
				result = await events.next();
			}

			if (!result.value) {
				send("failed", { message: "Download completed without producing a file path." });
				return;
			}

			const { filePath } = result.value;
			const origin = new URL(c.req.url).origin;
			const filename = sanitizeFilename(
				requestedFilename || path.basename(filePath) || "download.mp4",
			);
			send("ready", {
				downloadUrl: generateFileUrl(filePath, origin, c),
				filename,
				contentType: contentTypeFor(selectedChoice.kind, selectedChoice.ext),
			});

			// The file is deleted only after the browser has fetched and the
			// byte-delivery route has finished streaming it (see /api/download).
			// Delete the transient probe metadata now so it doesn't leak if the
			// download is never followed.
			void fs.rm(infoJsonToUse, { force: true }).catch(() => {});
		} catch (error) {
			const msg = error instanceof Error ? error.message : "Download failed";
			send("failed", { message: msg });
		}
	});
});

/**
 * GET /api/download
 * Deliver an already-prepared file. The `file` parameter is signed by the
 * progress endpoint so arbitrary filesystem paths cannot be requested.
 */
downloadRouter.get("/api/download", async (c) => {
	const filePath = c.req.query("file");
	const signature = c.req.query("sig");

	if (!filePath || !signature) {
		return c.json({ success: false, error: "Missing required download parameters" }, 400);
	}

	if (!verifyUrl(filePayload({ file: filePath }), signature, c)) {
		return c.json({ success: false, error: "Invalid download signature" }, 403);
	}

	try {
		const stat = await fs.stat(filePath);
		const ext = path.extname(filePath).slice(1);
		const filename = sanitizeFilename(path.basename(filePath) || "download.mp4");

		c.header("Content-Type", contentTypeFor(ext === "mp3" ? "audio" : "video", ext));
		c.header("Content-Disposition", `attachment; filename="${filename}"`);
		c.header("Content-Length", String(stat.size));

		const readStream = createReadStream(filePath);
		return stream(c, async (s) => {
			try {
				for await (const chunk of readStream) {
					await s.write(chunk as Uint8Array);
				}
			} finally {
				await fs.rm(filePath, { force: true }).catch(() => {});
				await fs.rm(`${filePath}.part`, { force: true }).catch(() => {});
				await fs.rm(`${filePath}.ytdl`, { force: true }).catch(() => {});
			}
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : "File not found";
		return c.json({ success: false, error: msg }, 404);
	}
});

function contentTypeFor(kind: "video" | "audio", _ext: string): string {
	return kind === "audio" ? "audio/mpeg" : "video/mp4";
}

/**
 * GET /api/info
 * Query engine status.
 */
downloadRouter.get("/api/info", (c) => {
	return c.json({
		engine: "yt-dlp",
		status: "ok",
	});
});

export { downloadRouter };
