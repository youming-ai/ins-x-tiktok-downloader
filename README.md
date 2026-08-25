# Snatch

[![CI](https://github.com/youming-ai/snatch/actions/workflows/ci.yml/badge.svg)](https://github.com/youming-ai/snatch/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Bun](https://img.shields.io/badge/Bun-%3E%3D1.3.14-black)](https://bun.sh)

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

The recommended deployment is the all-in-one Docker image on a VPS. The API
serves the built SPA and `/api/*` on one origin. This is the only tier that runs
the yt-dlp engine (it needs `child_process` + a filesystem, so it cannot run on
Cloudflare Workers/Pages).

```bash
cp .env.example .env
# edit .env with your settings
docker compose up -d --build
# App (UI + API) -> http://localhost:${APP_PORT}
```

Put the container behind your reverse proxy (Nginx, Traefik, Caddy, etc.) with a
TLS certificate. The container listens on port `3001`; `APP_PORT` only changes the
host-published port. `ALLOWED_ORIGINS` can stay empty because the SPA is served
same-origin by the API.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/resolve` | Extract video information and available resolution choices via yt-dlp |
| GET | `/api/download/progress` | Server-sent events: run yt-dlp for the selected format and stream live progress |
| GET | `/api/download` | Deliver the prepared file after the progress endpoint signals it is ready |
| GET | `/api/info` | Query engine status |
| GET | `/health` | Health check |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). PRs welcome — please run `bunx biome ci . && bun run typecheck && bun test && bun run build` before pushing.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE)
