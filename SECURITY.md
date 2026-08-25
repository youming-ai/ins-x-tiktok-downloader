# Security Policy

## Supported Versions

Only the `main` branch receives security updates.

## Reporting a Vulnerability

Please **do not** open a public issue.

Email `youmin.tang@elestyle.jp` with a description, reproduction steps, and impact.
You will receive an acknowledgement within 48 hours. If you do not, please open a minimal GitHub issue stating that you sent a security report (without details).

We will coordinate a fix and disclosure timeline with you.

## Scope & Notes

- `validateUrl()` in `packages/shared` rejects private / loopback / link-local / single-label hosts, but it is a literal-hostname check only — it does not resolve DNS and cannot stop DNS rebinding or redirects that `yt-dlp` may follow. Do not expose the API to untrusted networks without additional network-level egress controls if that is a concern.
- Download URLs are HMAC-SHA256 signed (`PROXY_SIGNING_KEY`). Set a stable `PROXY_SIGNING_KEY` in production so signatures survive restarts; otherwise links are invalidated on restart by design.
- When `API_KEY` is set, `/api/*` requires `Authorization: Api-Key <value>`. Leave it unset only for public / local instances.
