import { validateUrl } from "@snatch/shared";
import { z } from "zod";

/**
 * Zod schema for the untrusted request boundary. Kept here (not in
 * `@snatch/shared`, which stays dependency-free) and layered over the pure
 * `validateUrl` host check so validation logic lives in one place.
 */

export const resolveInputSchema = z
	.object({
		url: z.string({ error: "URL is required" }),
	})
	.transform((data, ctx) => {
		const url = data.url.trim();
		const result = validateUrl(url);
		if (!result.valid) {
			ctx.addIssue({ code: "custom", message: result.error ?? "Invalid URL" });
			return z.NEVER;
		}
		return { url };
	});
