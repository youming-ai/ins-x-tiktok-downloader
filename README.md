# Snatch

Social media video downloader — Bun monorepo: a React + TanStack Start SPA served by a Hono API powered by a native `yt-dlp` engine.

## Supported Sites

Snatch is a thin shell around `yt-dlp`, so it accepts a link from any of the
~1,800 sites yt-dlp supports. There is no host allowlist; the engine decides
what it can actually extract, and some sites need cookies or fail behind
anti-bot measures. The SPA highlights the popular ones (YouTube, X/Twitter,
Instagram, Threads, TikTok, Vimeo, Twitch, Reddit, Facebook) from `SERVICES` in
`packages/shared/src/constants.ts`.

Private, loopback, link-local and single-label hosts are refused at the request
boundary — see `validateUrl()` in `packages/shared/src/validation.ts`.

## Project Structure

```
snatch/
├── packages/
│   ├── api/                # Bun + Hono API server
│   │   ├── src/
│   │   │   ├── routes/     # /health, /api/resolve, /api/download
│   │   │   └── lib/        # ytdlp, security
│   │   └── test/
│   ├── web/                # React 19 + TanStack Start SPA (static client)
│   │   ├── src/
│   │   │   ├── routes/     # __root document shell and file-based routes
│   │   │   ├── components/ # DownloaderApp, DownloaderInput, ErrorBoundary
│   │   │   ├── router.tsx  # TanStack Router factory
│   │   │   └── styles.css
│   │   └── public/         # favicon, logos, manifest, robots.txt
│   └── shared/             # Types, validation, constants (zero deps)
│       └── src/
├── docker-compose.yml
├── package.json            # Bun workspace root
└── .env.example
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) >= 1.3
- `ffmpeg` installed on system

### Install

```bash
bun install
```

### Development

```bash
# Terminal 1: Start API (hot reload)
bun dev:api
# -> http://localhost:3001

# Terminal 2: Start frontend (Vite dev server, proxies /api → :3001)
bun dev
# -> http://localhost:5173
```

### Testing

```bash
bun test                 # all packages
bun run test:api         # API only
bun run test:web         # web only
bun run test:shared      # shared only
```

### Type Checking

```bash
bun run typecheck
```

### Lint & Format

```bash
bun run check            # lint + auto-fix
bun run lint             # lint only
bun run format           # format only
```

## Deployment

Two supported topologies.

### All-in-one (Docker / Dokploy) — recommended

The API serves the built SPA and `/api/*` on one origin. This is the only tier
that runs the yt-dlp engine (it needs `child_process` + a filesystem, so it
cannot run on Cloudflare Workers/Pages).

```bash
cp .env.example .env
docker compose up -d --build
# App (UI + API) -> http://localhost:38700
```

On Dokploy: point the app's domain at the `app` service (port `3001`).

### Split origin (Cloudflare Worker frontend + Dokploy API)

Host the static SPA on a Cloudflare Worker (Workers Static Assets) and keep the
API on Dokploy. The yt-dlp engine cannot run on Workers, so the Worker serves
only the built client; all `/api/*` calls go to the Dokploy origin.

1. **API (Dokploy)** — deploy the Docker image as above and set
   `ALLOWED_ORIGINS` to the Worker origin (e.g. `https://snatch.um1ng.me`)
   so the browser may call `/api/resolve` cross-origin.
2. **Frontend (Cloudflare Worker)** — `wrangler.jsonc` (repo root) configures an
   assets-only Worker serving `packages/web/dist/client` with SPA fallback. In the
   Cloudflare Worker build settings:
   - Build command: `bun run build:cf`
   - Deploy command: `bun run deploy:cf` (runs `wrangler deploy`)
   - Build env `VITE_API_BASE_URL` = the public API origin (e.g. `https://snatch-api.um1ng.me`)
   - The deploy token needs **Account → Workers Scripts → Edit** (plus `CLOUDFLARE_ACCOUNT_ID`)

Downloads stream directly from the API origin via `Content-Disposition`, so
only `/api/resolve` needs CORS.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/resolve` | Extract video information and available resolution choices via yt-dlp |
| GET | `/api/download` | Execute download for chosen format and stream bytes back |
| GET | `/api/info` | Query engine status |
| GET | `/health` | Health check |

## License

MIT
