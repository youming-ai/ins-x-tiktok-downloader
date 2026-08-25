# Contributing

Thanks for considering a contribution!

## Development

Prerequisites: [Bun](https://bun.sh/) >= 1.3.14, `ffmpeg` on PATH.

```bash
bun install          # installs git hooks via lefthook
bun dev:api          # API on :3001 (watch)
bun dev              # web on :5173 (proxies /api → :3001)
```

## Before You Push

```bash
bunx biome ci .      # lint (Biome: tabs, 100 cols, double quotes)
bun run typecheck    # tsc --noEmit across all packages
bun test             # bun:test, no mocking lib
bun run build        # shared typecheck + api bundle + web build
```

CI runs the same four steps on every PR to `main` (`.github/workflows/ci.yml`).
The pre-commit hook auto-fixes Biome on staged files; pre-push runs `typecheck`.

## Conventions

- **No new dep in `packages/shared`** — it is zero-dependency by design.
- Import via barrel: `import { … } from "@snatch/shared"` — never a subpath.
- One Hono router per file in `packages/api/src/routes/`, exported as `<name>Router`.
- Keep `packages/api/src/schemas/media.ts` as the request-boundary narrow point.
- TanStack Start is SPA-only (`ssr: false`) — do not add SSR.
- `bun run build` — never bare `bun build` (Bun's built-in bundler).

See `AGENTS.md` for the full architecture and data-flow reference.

## Pull Requests

- Keep PRs focused and small; delete old code paths instead of shimming.
- Describe the change and how you tested it (browser smoke test for UI, `packages/api/test` for API).
- AI-assisted commits must include `Co-Authored-By: Claude <noreply@anthropic.com>`.
