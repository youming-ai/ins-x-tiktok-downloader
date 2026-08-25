import * as crypto from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { env } from "hono/adapter";

const SCHEME = "Api-Key ";

/**
 * Optional API-key gate for self-hosted instances.
 *
 * When `API_KEY` is unset (the default) the middleware is a no-op and the API
 * stays public — preserving existing behavior. When set, every `/api/*`
 * request must carry `Authorization: Api-Key <value>` matching the configured
 * secret via a constant-time compare, matching the scheme the web client
 * already sends.
 *
 * Mount AFTER rateLimit so even unauthenticated probes are counted against the
 * abuse budget. CORS preflight (OPTIONS) is short-circuited by the cors
 * middleware upstream, but we skip OPTIONS defensively too.
 */
export function apiKeyAuth(): MiddlewareHandler {
	return async (c, next) => {
		if (c.req.method === "OPTIONS") {
			await next();
			return;
		}

		// Signed download routes carry an HMAC that already proves the request
		// came from this server. Requiring an API key here would break the
		// browser's EventSource / <a download> flow, which cannot set headers.
		const path = c.req.path;
		if (path === "/api/download/progress" || path === "/api/download") {
			await next();
			return;
		}

		const expected = env(c).API_KEY as string | undefined;
		if (!expected) {
			await next();
			return;
		}

		const header = c.req.header("Authorization") ?? "";
		if (!header.startsWith(SCHEME)) {
			return c.json({ success: false, error: "Missing or invalid Authorization header" }, 401);
		}

		const provided = header.slice(SCHEME.length);
		const a = Buffer.from(provided);
		const b = Buffer.from(expected);
		// Length is checked first because timingSafeEqual throws on mismatched
		// lengths; the early return also avoids leaking length via timing.
		if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
			return c.json({ success: false, error: "Invalid API key" }, 403);
		}

		await next();
	};
}
