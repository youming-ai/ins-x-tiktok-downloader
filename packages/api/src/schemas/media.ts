import { AUDIO_FORMATS, DOWNLOAD_MODES, VIDEO_QUALITIES, validateUrl } from "@snatch/shared";
import { z } from "zod";

/**
 * Zod schemas for the untrusted request boundary. Kept here (not in
 * `@snatch/shared`, which stays dependency-free) and layered over the pure
 * `validateUrl` host check so validation logic lives in one place.
 */

/** Query params arrive as "" when absent; treat that as unset. */
const emptyToUndefined = (value: unknown) => (value === "" || value == null ? undefined : value);

export const mediaOptionsSchema = z.object({
	audioFormat: z.preprocess(emptyToUndefined, z.enum(AUDIO_FORMATS).optional()),
	videoQuality: z.preprocess(emptyToUndefined, z.enum(VIDEO_QUALITIES).optional()),
	downloadMode: z.preprocess(emptyToUndefined, z.enum(DOWNLOAD_MODES).optional()),
});

export type MediaOptionsInput = z.infer<typeof mediaOptionsSchema>;

export const resolveInputSchema = mediaOptionsSchema
	.extend({ url: z.string({ error: "URL is required" }) })
	.transform((data, ctx) => {
		const url = data.url.trim();
		const result = validateUrl(url);
		if (!result.valid) {
			ctx.addIssue({ code: "custom", message: result.error ?? "Invalid URL" });
			return z.NEVER;
		}
		return { ...data, url };
	});
