/**
 * Core type definitions shared between API and web
 */

export interface ErrorResponse {
	success: boolean;
	error: string;
}

export interface MediaChoiceItem {
	id?: string;
	type: "video" | "audio";
	quality?: string;
	ext?: string;
	label?: string;
	url: string;
	thumb?: string;
}

export interface ResolveResponse {
	status: "picker" | "error";
	filename?: string;
	title?: string;
	thumbnail?: string;
	duration?: number;
	picker?: MediaChoiceItem[];
	error?: { code?: string; message?: string; context?: Record<string, unknown> };
}
