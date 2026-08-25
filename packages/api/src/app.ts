import * as Sentry from "@sentry/bun";
import { Hono } from "hono";
import { env } from "hono/adapter";
import { cors } from "hono/cors";
import { type PinoLogger, pinoLogger } from "hono-pino";
import pino from "pino";

export const logger = pino({
	level: process.env.LOG_LEVEL ?? "info",
	redact: {
		paths: [
			"req.headers.authorization",
			"req.headers.cookie",
			"req.headers['set-cookie']",
			"res.headers['set-cookie']",
		],
		censor: "[redacted]",
	},
});

export { Sentry };

import { apiKeyAuth } from "./middleware/auth";
import { rateLimit } from "./middleware/rate-limit";
import { downloadRouter } from "./routes/download";
import { healthRouter } from "./routes/health";

const app = new Hono<{ Variables: { logger: PinoLogger } }>();

app.use(
	"*",
	pinoLogger({
		pino: logger,
		http: {
			onReqBindings: (c) => ({ req: { method: c.req.method, url: c.req.path } }),
			onResBindings: (c) => ({ res: { status: c.res.status } }),
			onResLevel: (c) => {
				if (c.res.status >= 500) return "error";
				if (c.res.status >= 400) return "warn";
				return "info";
			},
		},
	}),
);

app.use(
	"/api/*",
	cors({
		origin: (origin, c) => {
			const allowedOrigins = env(c).ALLOWED_ORIGINS as string | undefined;
			const allowed = allowedOrigins
				?.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			if (!allowed?.length) {
				return "";
			}
			return allowed.includes(origin) ? origin : allowed[0];
		},
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Authorization", "Content-Type"],
	}),
);

app.use("/api/*", rateLimit());
// Mounted after rateLimit so unauthenticated probes still consume the
// per-client abuse budget before being rejected.
app.use("/api/*", apiKeyAuth());

app.route("/", downloadRouter);
app.route("/", healthRouter);

app.onError((err, c) => {
	Sentry.captureException(err);
	c.var.logger?.error({ err }, "unhandled");
	return c.json({ success: false, error: "Internal server error" }, 500);
});

export default app;
