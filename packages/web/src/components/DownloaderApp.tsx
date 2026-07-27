import { type ResolveResponse, SERVICES, validateUrl } from "@snatch/shared";
import { CheckCircle, Download, Loader2, Settings, X, XCircle } from "lucide-react";
import { useCallback, useState } from "react";
import { API_BASE_URL } from "../config";
import { Sentry } from "../lib/sentry";
import { DownloaderInput } from "./DownloaderInput";
import { DEFAULT_SETTINGS, SettingsDrawer, type SettingsState } from "./SettingsDrawer";

type PickerResponse = ResolveResponse;

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
	const [savedName, setSavedName] = useState<string | null>(null);
	const [pickerResponse, setPickerResponse] = useState<PickerResponse | null>(null);
	// Represents a completed resolution, not the editable form value.
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
		if (savedName) setSavedName(null);
		if (pickerResponse) setPickerResponse(null);
		if (resolvedUrl) setResolvedUrl(null);
	};

	const triggerDownload = useCallback((downloadUrl: string) => {
		const anchor = document.createElement("a");
		anchor.href = downloadUrl;
		anchor.download = ""; // Filename is governed by Content-Disposition header
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
	}, []);

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
		setSavedName(null);
		setPickerResponse(null);
		setResolvedUrl(null);

		const { apiKey, ...mediaOptions } = settings;

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
				body: JSON.stringify({ url, ...mediaOptions }),
			});
			const data = (await response.json().catch(() => ({}))) as
				| ResolveResponse
				| { success?: boolean; error?: string };

			// Transport/HTTP-level failures (rate-limit 429, gateway 5xx, a body
			// we couldn't parse). Surface the server's structured message when it
			// sent one, otherwise derive from the status so the user isn't left
			// looking at a silent no-op.
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
							loading={loading}
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

					{savedName && (
						<div className="max-w-2xl mx-auto animate-in fade-in zoom-in duration-300">
							<div
								role="status"
								aria-live="polite"
								className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center gap-3 text-left"
							>
								<CheckCircle className="w-5 h-5 shrink-0 text-green-400" />
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium text-green-300">Download started</p>
									<p className="text-xs text-gray-400 truncate font-mono">{savedName}</p>
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
									onClick={() => setSavedName(null)}
									className="shrink-0 text-gray-500 hover:text-white transition-colors"
								>
									<X className="w-4 h-4" />
								</button>
							</div>
						</div>
					)}

					{/* Format Picker Panel */}
					{pickerResponse?.picker && (
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
										onClick={() => {
											triggerDownload(item.url);
											setSavedName(item.label || item.quality || "file");
										}}
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
							<p className="text-gray-400">
								Fetching the highest quality media — long videos may take a moment...
							</p>
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

			{/* Settings Drawer Slider */}
			<SettingsDrawer
				isOpen={isSettingsOpen}
				onClose={() => setIsSettingsOpen(false)}
				settings={settings}
				onSettingsChange={handleSettingsChange}
			/>
		</div>
	);
}
