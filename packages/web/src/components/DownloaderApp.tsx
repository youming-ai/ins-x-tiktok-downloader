import { type MediaChoiceItem, type ResolveResponse, SERVICES, validateUrl } from "@snatch/shared";
import { CheckCircle, Download, Loader2, Settings, X, XCircle } from "lucide-react";
import { useCallback, useState } from "react";
import { API_BASE_URL } from "../config";
import { Sentry } from "../lib/sentry";
import { DownloaderInput } from "./DownloaderInput";

type SettingsState = { apiKey: string };

const DEFAULT_SETTINGS: SettingsState = { apiKey: "" };

type PickerResponse = ResolveResponse;

type DownloadProgress = {
	downloadedBytes: number;
	totalBytes?: number;
	speed?: number;
	eta?: number;
	part: number;
	totalParts: number;
};

type DownloadPhase =
	| { status: "idle" }
	| {
			status: "downloading";
			item: MediaChoiceItem;
			progress?: DownloadProgress;
			processing: boolean;
	  }
	| { status: "done"; filename: string }
	| { status: "error"; message: string };

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "";
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "";
	const s = Math.round(seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
	const ss = String(sec).padStart(2, "0");
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatSpeed(bytesPerSecond: number): string {
	if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";
	return `${formatBytes(bytesPerSecond)}/s`;
}

function formatEta(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "";
	return formatDuration(seconds);
}

export function DownloaderApp() {
	// Settings & Drawer
	const [settings, setSettings] = useState<SettingsState>(() => {
		try {
			const saved = localStorage.getItem("snatch_settings");
			return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
		} catch {
			return DEFAULT_SETTINGS;
		}
	});
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);

	// Core State
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [downloadPhase, setDownloadPhase] = useState<DownloadPhase>({ status: "idle" });
	const [pickerResponse, setPickerResponse] = useState<PickerResponse | null>(null);
	const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

	// Sync settings to localStorage
	const handleSettingsChange = (nextSettings: SettingsState) => {
		setSettings(nextSettings);
		try {
			localStorage.setItem("snatch_settings", JSON.stringify(nextSettings));
		} catch (error) {
			Sentry.captureException(error);
		}
	};

	const handleInputValueChange = () => {
		if (error) setError(null);
		if (downloadPhase.status !== "idle") setDownloadPhase({ status: "idle" });
		if (pickerResponse) setPickerResponse(null);
		if (resolvedUrl) setResolvedUrl(null);
	};

	const triggerFileDownload = useCallback((downloadUrl: string, filename: string) => {
		const anchor = document.createElement("a");
		anchor.href = downloadUrl;
		anchor.download = filename;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
	}, []);

	const startDownload = useCallback(
		(item: MediaChoiceItem) => {
			setDownloadPhase({ status: "downloading", item, processing: false });

			const source = new EventSource(`${API_BASE_URL}${item.url}`);

			source.addEventListener("progress", (event) => {
				try {
					const data = JSON.parse(event.data) as DownloadProgress;
					setDownloadPhase((prev) =>
						prev.status === "downloading" ? { ...prev, progress: data, processing: false } : prev,
					);
				} catch {
					// ignore malformed progress event
				}
			});

			source.addEventListener("processing", () => {
				setDownloadPhase((prev) =>
					prev.status === "downloading" ? { ...prev, processing: true } : prev,
				);
			});

			source.addEventListener("ready", (event) => {
				source.close();
				try {
					const data = JSON.parse(event.data) as {
						downloadUrl: string;
						filename: string;
						contentType: string;
					};
					triggerFileDownload(data.downloadUrl, data.filename);
					setDownloadPhase({ status: "done", filename: data.filename });
				} catch {
					setDownloadPhase({ status: "error", message: "Download ready event was malformed." });
				}
			});

			source.addEventListener("failed", (event) => {
				source.close();
				try {
					const data = JSON.parse((event as MessageEvent).data ?? "{}") as { message?: string };
					setDownloadPhase({ status: "error", message: data.message ?? "Download failed." });
				} catch {
					setDownloadPhase({ status: "error", message: "Download failed." });
				}
			});

			source.onerror = () => {
				source.close();
				setDownloadPhase((prev) =>
					prev.status === "downloading"
						? { status: "error", message: "Connection to download progress stream lost." }
						: prev,
				);
			};
		},
		[triggerFileDownload],
	);

	const handleDownload = async (rawUrl: string) => {
		const url = rawUrl.trim();
		if (!url) {
			setError("Please enter a valid URL");
			return;
		}

		const validation = validateUrl(url);
		if (!validation.valid) {
			setError(validation.error ?? "Invalid URL");
			return;
		}

		setLoading(true);
		setError(null);
		setDownloadPhase({ status: "idle" });
		setPickerResponse(null);
		setResolvedUrl(null);

		const { apiKey } = settings;

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (apiKey) {
			headers.Authorization = `Api-Key ${apiKey}`;
		}

		try {
			const response = await fetch(`${API_BASE_URL}/api/resolve`, {
				method: "POST",
				headers,
				body: JSON.stringify({ url }),
			});
			const data = (await response.json().catch(() => ({}))) as
				| ResolveResponse
				| { success?: boolean; error?: string };

			if (!response.ok) {
				const serverError = "success" in data && typeof data.error === "string" ? data.error : null;
				throw new Error(serverError || `Request failed (${response.status})`);
			}

			if ("success" in data) {
				throw new Error(typeof data.error === "string" ? data.error : "Failed to resolve media");
			}

			const resolveData = data as ResolveResponse;

			if (resolveData.status === "error") {
				throw new Error(
					resolveData.error?.message || resolveData.error?.code || "Failed to resolve media",
				);
			}

			if (resolveData.status === "picker") {
				setPickerResponse(resolveData);
				setResolvedUrl(url);
			}
		} catch (error) {
			Sentry.captureException(error);
			setError(
				error instanceof Error ? error.message : "Failed to resolve content. Please try again.",
			);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="min-h-screen bg-black text-white selection:bg-purple-500/30">
			{/* Background Effects */}
			<div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
				<div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-purple-600/20 blur-[120px]" />
				<div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-600/20 blur-[120px]" />
				<div className="absolute top-[20%] right-[10%] w-[30%] h-[30%] rounded-full bg-pink-600/10 blur-[100px]" />
			</div>

			{/* Settings Toggle and Main Page Header Overlay */}
			<div className="absolute top-6 right-6 z-20">
				<button
					type="button"
					onClick={() => setIsSettingsOpen(true)}
					aria-label="Settings"
					className="p-3 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 hover:border-white/20 transition-all text-zinc-300 hover:text-white flex items-center justify-center"
				>
					<Settings className="w-5 h-5" />
				</button>
			</div>

			{/* Main Content */}
			<div className="relative z-10 container mx-auto px-4 py-20 md:py-32 space-y-20">
				{/* Hero Section */}
				<div className="text-center space-y-10 max-w-4xl mx-auto">
					<div className="space-y-6">
						<div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-700">
							<span className="relative flex h-2 w-2">
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
								<span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
							</span>
							<span className="text-sm font-medium text-gray-300">1,800+ sites supported</span>
						</div>

						<h1 className="text-5xl md:text-7xl font-bold tracking-tight animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100">
							<span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
								Snatch
							</span>
						</h1>

						<p className="text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200">
							Paste a link, get the file. Videos, audio and images from your favorite platforms — no
							watermarks, no signup, completely free.
						</p>
					</div>

					{/* Download Input */}
					<div className="max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-8 duration-700 delay-300">
						<DownloaderInput
							onSubmit={handleDownload}
							onValueChange={handleInputValueChange}
							loading={loading || downloadPhase.status === "downloading"}
						/>
					</div>

					{error && (
						<div className="max-w-2xl mx-auto animate-in fade-in zoom-in duration-300">
							<div
								role="alert"
								aria-live="assertive"
								className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400"
							>
								<XCircle className="w-5 h-5 shrink-0" />
								<p className="text-sm font-medium">{error}</p>
							</div>
						</div>
					)}

					{downloadPhase.status === "error" && (
						<div className="max-w-2xl mx-auto animate-in fade-in zoom-in duration-300">
							<div
								role="alert"
								aria-live="assertive"
								className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400"
							>
								<XCircle className="w-5 h-5 shrink-0" />
								<p className="text-sm font-medium">{downloadPhase.message}</p>
							</div>
						</div>
					)}

					{downloadPhase.status === "done" && (
						<div className="max-w-2xl mx-auto animate-in fade-in zoom-in duration-300">
							<div
								role="status"
								aria-live="polite"
								className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center gap-3 text-left"
							>
								<CheckCircle className="w-5 h-5 shrink-0 text-green-400" />
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium text-green-300">Download started</p>
									<p className="text-xs text-gray-400 truncate font-mono">
										{downloadPhase.filename}
									</p>
								</div>
								{resolvedUrl && (
									<button
										type="button"
										onClick={() => {
											void handleDownload(resolvedUrl);
										}}
										className="shrink-0 text-xs font-medium text-green-300 hover:text-green-200 underline underline-offset-2"
									>
										Again
									</button>
								)}
								<button
									type="button"
									aria-label="Dismiss"
									onClick={() => setDownloadPhase({ status: "idle" })}
									className="shrink-0 text-gray-500 hover:text-white transition-colors"
								>
									<X className="w-4 h-4" />
								</button>
							</div>
						</div>
					)}

					{/* Downloading Progress Panel */}
					{downloadPhase.status === "downloading" && (
						<div className="max-w-2xl mx-auto space-y-6 text-left animate-in fade-in zoom-in duration-300 p-6 bg-zinc-900/40 border border-zinc-800 rounded-2xl">
							<div className="flex items-center justify-between gap-4">
								<div className="min-w-0">
									<h3 className="text-lg font-bold text-white truncate">
										{pickerResponse?.title || "Downloading"}
									</h3>
									<p className="text-xs text-zinc-500 mt-1">
										{downloadPhase.item.label || downloadPhase.item.quality || "file"}
									</p>
								</div>
								<button
									type="button"
									onClick={() => setDownloadPhase({ status: "idle" })}
									className="shrink-0 p-1 px-3 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white text-xs font-semibold rounded-lg transition-colors border border-white/5"
								>
									Cancel
								</button>
							</div>

							<div className="space-y-2">
								{downloadPhase.processing || !downloadPhase.progress ? (
									<div className="flex items-center gap-3 py-2">
										<Loader2 className="w-5 h-5 animate-spin text-purple-400" />
										<span className="text-sm text-zinc-300">
											{downloadPhase.processing ? "Processing…" : "Starting download…"}
										</span>
									</div>
								) : (
									(() => {
										const p = downloadPhase.progress;
										const pct =
											p.totalBytes && p.totalBytes > 0
												? Math.min(1, p.downloadedBytes / p.totalBytes)
												: undefined;
										return (
											<>
												<div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
													<div
														className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-300"
														style={{ width: `${(pct ?? 0) * 100}%` }}
													/>
												</div>
												<div className="flex justify-between text-xs text-zinc-500">
													<span>
														{formatBytes(p.downloadedBytes)}
														{p.totalBytes ? ` / ${formatBytes(p.totalBytes)}` : ""}
													</span>
													<span>
														{p.totalParts > 1 ? `part ${p.part + 1}/${p.totalParts} · ` : ""}
														{formatSpeed(p.speed ?? 0)}
														{p.eta ? ` · ${formatEta(p.eta)} left` : ""}
													</span>
												</div>
											</>
										);
									})()
								)}
							</div>
						</div>
					)}

					{/* Format Picker Panel */}
					{pickerResponse?.picker && downloadPhase.status !== "downloading" && (
						<div className="max-w-2xl mx-auto space-y-6 text-left animate-in fade-in zoom-in duration-300 p-6 bg-zinc-900/40 border border-zinc-800 rounded-2xl">
							<div className="flex items-start justify-between gap-4">
								<div className="flex items-center gap-3 min-w-0">
									{pickerResponse.thumbnail && (
										<img
											src={pickerResponse.thumbnail}
											alt=""
											className="w-16 h-16 rounded-lg object-cover shrink-0 bg-zinc-950"
										/>
									)}
									<div className="min-w-0">
										<h3 className="text-lg font-bold text-white truncate">
											{pickerResponse.title || "Choose a format"}
										</h3>
										<p className="text-xs text-zinc-500 mt-1">
											Pick a resolution or audio-only format to download.
										</p>
									</div>
								</div>
								<button
									type="button"
									onClick={() => setPickerResponse(null)}
									className="shrink-0 p-1 px-3 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white text-xs font-semibold rounded-lg transition-colors border border-white/5"
								>
									Clear
								</button>
							</div>

							<div className="flex flex-col gap-2">
								{pickerResponse.picker.map((item) => (
									<button
										key={item.id || item.url}
										type="button"
										onClick={() => startDownload(item)}
										className="w-full px-4 py-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-purple-500/40 rounded-xl text-sm font-medium text-zinc-200 transition-colors flex items-center justify-between gap-3"
									>
										<span className="flex items-center gap-2 min-w-0">
											<span className="px-2 py-0.5 rounded bg-black/60 text-[9px] uppercase font-bold text-zinc-400 tracking-wider shrink-0">
												{item.type}
											</span>
											<span className="truncate">{item.label || item.quality || item.ext}</span>
										</span>
										<Download className="w-4 h-4 shrink-0 text-purple-400" />
									</button>
								))}
							</div>
						</div>
					)}
				</div>

				{/* Loading State */}
				{loading && (
					<div className="flex flex-col items-center justify-center py-12 space-y-6 animate-in fade-in duration-300">
						<div className="relative">
							<div className="absolute inset-0 bg-purple-500/20 blur-xl rounded-full"></div>
							<Loader2 className="w-12 h-12 animate-spin text-purple-400 relative z-10" />
						</div>
						<div className="text-center space-y-2">
							<h3 className="text-xl font-semibold text-white">Preparing your download</h3>
							<p className="text-gray-400">Fetching available formats from the source...</p>
						</div>
					</div>
				)}

				{/* Popular Services */}
				<div className="space-y-8 max-w-4xl mx-auto">
					<div className="text-center space-y-3">
						<h2 className="text-2xl md:text-3xl font-bold">Popular services</h2>
						<p className="text-gray-400 max-w-2xl mx-auto text-sm">
							These are the links people paste most. Snatch runs on yt-dlp, so you can paste a URL
							from any of the ~1,800 sites it supports — some need cookies or block downloads, so
							not every link resolves.
						</p>
					</div>

					<div className="flex flex-wrap justify-center gap-2.5">
						{SERVICES.map((service) => (
							<span
								key={service.id}
								className="px-3.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-300 hover:border-white/25 hover:text-white transition-colors animate-in fade-in duration-300"
							>
								{service.label}
							</span>
						))}
					</div>

					<p className="text-center text-xs text-gray-600 max-w-2xl mx-auto leading-relaxed">
						Support for a service means technical compatibility only — it does not imply
						affiliation, endorsement, or any other relationship.
					</p>
				</div>

				{/* Features */}
				<div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto pt-8 border-t border-white/5">
					{[
						{
							title: "Lightning Fast",
							description: "Optimized extraction ensures downloads start in seconds.",
							icon: "⚡",
						},
						{
							title: "Highest Quality",
							description: "We always fetch the maximum resolution available from the source.",
							icon: "💎",
						},
						{
							title: "100% Free",
							description: "No hidden fees, no registration, just unlimited downloads.",
							icon: "🎁",
						},
					].map((feature) => (
						<div key={feature.title} className="text-center p-6 space-y-4">
							<div className="text-4xl mb-4">{feature.icon}</div>
							<h3 className="text-lg font-bold text-white">{feature.title}</h3>
							<p className="text-sm text-gray-400 leading-relaxed">{feature.description}</p>
						</div>
					))}
				</div>
			</div>

			{/* Settings — ponytail: single field, inline overlay instead of separate Drawer component */}
			{isSettingsOpen && (
				<div className="fixed inset-0 z-50 flex justify-end">
					<button
						type="button"
						onClick={() => setIsSettingsOpen(false)}
						aria-label="Close settings"
						className="absolute inset-0 bg-black/60 backdrop-blur-sm"
					/>
					<div className="relative w-full max-w-md h-full bg-zinc-950 border-l border-zinc-800 p-6 flex flex-col gap-6 shadow-2xl overflow-y-auto">
						<div className="flex items-center justify-between pb-4 border-b border-zinc-800">
							<h2 className="text-xl font-bold text-white">Download Settings</h2>
							<button
								type="button"
								onClick={() => setIsSettingsOpen(false)}
								aria-label="Close"
								className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900"
							>
								<X className="w-5 h-5" />
							</button>
						</div>
						<div className="space-y-1.5">
							<label htmlFor="apiKey" className="text-sm font-medium text-zinc-300">
								API Authorization Key
							</label>
							<input
								id="apiKey"
								type="password"
								placeholder="Enter backend authorization API key"
								value={settings.apiKey}
								onChange={(e) => handleSettingsChange({ ...settings, apiKey: e.target.value })}
								className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
							/>
							<p className="text-xs text-zinc-500">
								Optional — only honored when the API sets <code className="font-mono">API_KEY</code>
								.
							</p>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
