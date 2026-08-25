# Repository Guidelines

Bun monorepo (3 workspace packages) that resolves and downloads media from social platforms. A React 19 + TanStack Start SPA (no SSR) talks to a Hono API that wraps a self-provisioning `yt-dlp` binary as its extraction engine. Ships as an **all-in-one** Docker image: the API serves the built SPA and the `/api/*` routes on one origin.

## Project Overview

- Paste a URL → API probes it with `yt-dlp` → returns signed per-format download choices → browser opens an SSE progress stream → once the file is ready it downloads directly from the API via a plain `<a download>`.
- Supported sites: whatever `yt-dlp` reaches (~1,800). There is **no** host allowlist — `validateUrl` accepts any public http(s) URL and only refuses private/loopback/link-local/single-label hosts. `SERVICES` in `packages/shared/src/constants.ts` is UI copy for the "popular services" grid, mirroring upstream [yoinks](https://github.com/pablostanley/yoinks).
- The engine needs `child_process` + a writable filesystem, so it **cannot run on Cloudflare Workers/Pages** — the all-in-one Docker image is the intended production shape.

## Package Boundaries

| Package | Role | Entrypoint | Runtime deps |
|---|---|---|---|
| `packages/shared` | Types, constants, URL validation | `src/index.ts` | **zero** — no framework, no `zod` |
| `packages/api` | Hono server, yt-dlp engine, routes, middleware, URL signing | `src/index.ts` (Bun entry) | `hono`, `hono-pino`, `pino`, `zod`, `@sentry/bun`, `@snatch/shared` |
| `packages/web` | TanStack Start SPA (`ssr: false`) | `src/routes/__root.tsx` → `routes/index.tsx` | React 19, `@tanstack/react-{start,router,form}`, `@sentry/react`, `lucide-react`, `zod`, Tailwind v4 |

Import graph is strictly one-directional: `shared → {api, web}`; api and web never import each other. Consumers import the **barrel** (`import { … } from "@snatch/shared"`), never a subpath. `packages/shared/package.json` has no `dependencies` key — keep it that way.

## Architecture & Data Flow

```
All-in-one:  GET /             → Hono serves built SPA from ./public (serveStatic)
             POST /api/resolve → cors → rateLimit → apiKeyAuth → validateUrl
                                 → yt-dlp probe → buildChoices → HMAC-signed progress URL
             GET  /api/download/progress → verify signature → yt-dlp exec → SSE progress events
             GET  /api/download → verify file-path signature → stream + cleanup
```

- **Middleware order** (`src/app.ts`): `pinoLogger` (all) → `cors` → `rateLimit` → `apiKeyAuth`, all on `/api/*`, then routers at `/`. `app.onError` is the global net. `GET /health` is at root, outside `/api/*`, so it bypasses all middleware.
- **Signed downloads**: `/api/resolve` builds each choice's `/api/download/progress` URL absolute to the API origin and HMAC-signs the params (`lib/security.ts`). The progress endpoint runs yt-dlp, then signs a short-lived `/api/download?file=...` URL for the prepared file. `/api/download` re-verifies that file-path signature (timing-safe). Cross-origin downloads need no CORS because they are an `<a download>` navigation, not a `fetch`. Only `POST /api/resolve` is a cross-origin `fetch`, gated by `ALLOWED_ORIGINS`.
- **Two error shapes on `/api/resolve`**: validation failures → `400 {success:false, error}`; engine failures → `200 {status:"error", error:{code,message}}`. Clients branch on both `!response.ok` and `data.status === "error"`.
- **Engine** (`lib/ytdlp.ts`): `ensureYtDlp()` resolves the binary (PATH → `$YTDLP_DIR` cache → download), `probe()` runs `yt-dlp -J` and shape-guards stdout via `parseVideoInfo()`, `buildChoices()` derives video/audio choices, `downloadWithProgress()` runs yt-dlp with a `PROGRESS_TEMPLATE` and yields bytes/speed/ETA/processing events (mirroring yoinks), `executeDownload()` waits for completion and returns a cleanup callback. `ffmpeg` on PATH is required for merges and audio extraction.
- **Env access split**: request-scoped config (`ALLOWED_ORIGINS`, `API_RATE_LIMIT_*`, `API_KEY`, `PROXY_SIGNING_KEY`) via `env(c)`; process-lifetime config (`PORT`, `STATIC_ROOT`, `LOG_LEVEL`, `SENTRY_DSN`, `YTDLP_DIR`) via `process.env`. Web reads `import.meta.env` (`VITE_` prefix only).

## Key Directories

- `packages/shared/src/` — types, constants, pure URL validation; zero deps.
- `packages/api/src/routes/` — one Hono router per file, exported as `<name>Router`.
- `packages/api/src/lib/` — engine + singletons (`ytdlp`, `security`, `logger`, `sentry`).
- `packages/api/src/middleware/` — `/api/*` middleware (`rate-limit`, `auth`).
- `packages/api/src/schemas/` — Zod request narrowing.
- `packages/web/src/routes/` — file-based TanStack Router routes.
- `packages/web/src/components/` — React UI (`DownloaderApp`, `DownloaderInput`, `SettingsDrawer`, `ErrorBoundary`).

## Important Files

- `packages/api/src/index.ts` — Bun entry: layers `serveStatic` over the app, exports `{ port, fetch }`.
- `packages/api/src/app.ts` — Hono app + middleware chain; default-exports the raw `app`.
- `packages/api/src/routes/download.ts` — `POST /api/resolve`, signed `GET /api/download`, `GET /api/info`.
- `packages/api/src/lib/ytdlp.ts` — `ensureYtDlp`/`probe`/`buildChoices`/`executeDownload`/`parseVideoInfo`.
- `packages/api/src/lib/security.ts` — `signUrl`/`verifyUrl` (HMAC-SHA256, timing-safe), `sanitizeFilename`, `getSecret`.
- `packages/api/src/middleware/rate-limit.ts` — in-memory limiter keyed by `cf-connecting-ip`/`fly-client-ip` (not `x-forwarded-for`), UA-hash fallback; exports `clearClients()`.
- `packages/api/src/middleware/auth.ts` — `apiKeyAuth()`: optional `API_KEY`-gated `Authorization: Api-Key <value>`, no-op when unset.
- `packages/api/src/schemas/media.ts` — `resolveInputSchema` layers shared `validateUrl` onto structural Zod checks; narrow new request options here.
- `packages/shared/src/validation.ts` — exports only `validateUrl()` (pure). No `sanitizeUrl`, no `detectPlatform`.
- `packages/shared/src/constants.ts` — `SERVICES` (UI labels only, no hosts). `types.ts` — wire contract + `AUDIO_FORMATS`/`VIDEO_QUALITIES`/`DOWNLOAD_MODES`.
- `packages/web/src/config.ts` — `API_BASE_URL` (empty; SPA is served same-origin by the API). `components/DownloaderApp.tsx` — owns UI state + resolve/download flow.
- `packages/web/src/routeTree.gen.ts` — generated; commit it, never edit, excluded from Biome.
- `biome.json`, `bunfig.toml` (`[test] root="."`), `packages/api/Dockerfile` (two-stage; runtime installs `ca-certificates` + `ffmpeg` only), `docker-compose.yml` (generic VPS), `.env.example`, `.github/workflows/ci.yml`.

## Development Commands

```bash
bun install          # root; runs `lefthook install` via prepare

# Dev (two terminals)
bun dev:api          # :3001 — API with --watch
bun dev              # :5173 — Vite, proxies /api → :3001

# Build / deploy — ALWAYS `bun run` for aggregate scripts
bun run build        # shared typecheck + api build + web build

bun test             # all packages (bunfig.toml discovers every *.test.ts)
bun run typecheck    # tsc --noEmit across all packages (pre-push hook)
bun run check        # biome check --fix .  (pre-commit runs Biome on staged files)

bun run docker:up    # docker compose up -d --build
```

> **Gotcha**: `build`/`test` collide with Bun's reserved subcommands. Bare `bun test` works via `bunfig.toml`, but **bare `bun build` runs the bundler, not the aggregate script** — always `bun run build`. CI and the Dockerfile use `bun run`.

## Code Conventions & Common Patterns

- **Biome** owns formatting + linting. Tabs, line width **100**, double quotes, semicolons always, trailing commas all. Blocking: `noUnusedVariables`/`noUnusedImports`/`useConst`/`noUselessStringConcat` **error**; `noNonNullAssertion`/`noExplicitAny` **warn**. Scans `packages/*/src` (+ `api/test`), excludes `routeTree.gen.ts`.
- **Clean cutover**: migrate every caller and delete the old path — no aliases, shims, dead code, or commented-out blocks.
- **Validate at boundaries**: URL validation lives in `shared` (pure); both the API Zod schema and the web form call `validateUrl()`, so client feedback and server rejection never drift. Its host check is a cheap literal-hostname filter, not a network boundary — it cannot see a public name resolving to a private address, DNS rebinding, or redirects yt-dlp follows. Untrusted yt-dlp stdout passes through `parseVideoInfo()`. Keep `shared` zero-dependency.
- **Boundary narrowing**: request options flow through `schemas/media.ts`. Add new options to the shared enum arrays, not ad-hoc string checks.
- **Hono routes**: one file per router under `routes/`, exported `<name>Router`, mounted `app.route("/", <name>Router)`. Handlers always return `c.json(...)` with an explicit status.
- **React state**: no state library — `useState` per concern in `DownloaderApp`; TanStack Form owns form values. Root wraps the app in `ErrorBoundary`. `lucide-react` icons. Tailwind v4 is CSS-first (`src/styles.css`, no `tailwind.config.js`).
- **Sentry** is DSN-gated and independent per side: `@sentry/bun` (`SENTRY_DSN`) in API, `@sentry/react` (`VITE_SENTRY_DSN`) in SPA.

## Runtime / Tooling Preferences

- **Bun 1.3.14** (pinned in `packageManager`, CI, and both Docker stages). Bun workspaces only — fan-out via `bun --filter '<pkg>' <script>`; no turborepo/nx.
- **TanStack Start in SPA mode** (`ssr: false`); no SSR runtime is deployed. Server-side React / SSR is an anti-pattern here.
- **Browser-exposed env vars must use the `VITE_` prefix**; `VITE_SENTRY_DSN` also flows in as a Docker build ARG.
- Each package has a standalone strict `tsconfig.json` (`ES2022`, `moduleResolution bundler`, `noEmit`); no shared base, no project references.

## Testing & QA

- **Framework**: `bun:test` only (`describe`/`it`/`expect`/`beforeEach`/`afterEach`). No mocking library — isolation via real code paths, env save/restore, and the exported `clearClients()` hook.
- **HTTP pattern**: `app.fetch(new Request(...))` against a throwaway `new Hono()` (`createTestApp()` helper) or the real singleton from `../src/app`. Prefer `../src/app`, not `../src/index` (the latter mounts `serveStatic` + inits Sentry on import).
- **Coverage**: shared validation/hardening; API `apiKeyAuth`, `rateLimit`, resolve validation, signed `/api/download`, `buildChoices`, CORS-rejection. No coverage tooling configured.
- **No web unit tests** — the SPA is exercised via the browser.
- **Real downloads** need `yt-dlp` (auto-provisioned) and `ffmpeg` on PATH.
- **Smoke test**: `bun dev:api` + `bun dev`, open `http://localhost:5173`, paste a URL — unsupported host → red error card; valid host → format picker.

## Environment Variables

| Var | Service | Default | Purpose |
|---|---|---|---|
| `APP_PORT` | docker-compose | `38700` | Host port for `app` |
| `PORT` | API | `3001` | Container listen port |
| `ALLOWED_ORIGINS` | API | `""` (reject all) | Comma-separated CORS allowlist for `/api/*`. Unused in the all-in-one build (SPA is same-origin). |
| `API_KEY` | API | `""` (public) | When set, `/api/*` requires `Authorization: Api-Key <value>` |
| `API_RATE_LIMIT_MAX` / `_WINDOW` | API | `30` / `60000` | Rate limit count / window (ms) |
| `PROXY_SIGNING_KEY` | API | `""` (random) | HMAC key for media URLs. Empty → random per-process key (links die on restart) |
| `STATIC_ROOT` | API | `./public` | Static SPA directory |
| `LOG_LEVEL` | API | `info` | Pino log level |
| `SENTRY_DSN` | API | `""` | `@sentry/bun` DSN; disabled when unset |
| `YTDLP_DIR` | API | `~/.snatch/bin` | yt-dlp binary cache (Docker: `/data/yt-dlp`) |
| `VITE_API_TARGET` | web (dev) | `http://localhost:3001` | Vite `/api` proxy target |
| `VITE_SENTRY_DSN` | web (build) | `""` | `@sentry/react` DSN; disabled when unset |

## CI, Git Hooks & Attribution

- **CI** (`.github/workflows/ci.yml`, on PR + push to `main`): install → `bunx biome ci .` → `bun run typecheck` → `bun test` → `bun run build`. Validation-only; deploys happen out-of-band on the VPS.
- **Git hooks: lefthook** (not Husky). pre-commit → Biome on staged files (auto-stages fixes); pre-push → `bun run typecheck`.
- AI-assisted commits MUST include: `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Definition of Done

- `bun run check` and `bun run typecheck` pass.
- `bun test` passes.
- `bun run build` produces `packages/web/dist/client` and `packages/api/dist/index.js`.
- UI changes: browser smoke-test. API changes: verify in `packages/api/test/`.

## Anti-Patterns (avoid without discussion)

- Adding a runtime dependency to `packages/shared`.
- Hand-rolling URL parsing outside `validateUrl`.
- Server-side React / SSR.
- Bare `bun build` for the aggregate build (use `bun run build`).
- Bypassing lefthook hooks with `--no-verify`.
- Dead code, unused exports, or commented-out code instead of a clean delete.
- "MVP" / "scaffold" / "TODO: implement" labels in shipped code.

> The `docs/superpowers/` plans describe a prior Astro-based architecture and are **historical** — don't treat their file paths as authoritative.
