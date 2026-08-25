import * as Sentry from "@sentry/bun";
import { serveStatic } from "hono/bun";
import app, { logger } from "./app";

const dsn = process.env.SENTRY_DSN;
if (dsn) {
	Sentry.init({
		dsn,
		environment: process.env.NODE_ENV ?? "production",
		tracesSampleRate: 0,
	});
}

// Serve the static client (packages/web/dist/client, copied to ./public in the
// Docker image). Falls through to 404 when the dir is absent — e.g. local API
// dev, where the Vite dev server serves the UI and proxies /api here.
const staticRoot = process.env.STATIC_ROOT || "./public";
app.use("*", serveStatic({ root: staticRoot }));

const port = parseInt(process.env.PORT || "3001", 10);

logger.info({ port }, "Snatch running");

export default {
	port,
	fetch: app.fetch,
};
