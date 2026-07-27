/**
 * The services snatch names in the UI, mirroring the set upstream yoinks
 * highlights. This is **not** an allowlist: yt-dlp does the real extraction and
 * reaches ~1,800 sites, so any public http(s) URL is accepted (see
 * `validation.ts`). The list only drives the "popular services" grid.
 */
export const SERVICES = [
	{ id: "youtube", label: "YouTube" },
	{ id: "x", label: "X / Twitter" },
	{ id: "instagram", label: "Instagram" },
	{ id: "threads", label: "Threads" },
	{ id: "tiktok", label: "TikTok" },
	{ id: "vimeo", label: "Vimeo" },
	{ id: "twitch", label: "Twitch" },
	{ id: "reddit", label: "Reddit" },
	{ id: "facebook", label: "Facebook" },
] as const;

// Real share URLs never contain whitespace. `new URL()` parsing does the real
// work; this just rejects obviously malformed input.
export const WHITESPACE_ONLY_REGEX = /\s/;
