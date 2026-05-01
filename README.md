# XENEON EDGE Widget Builder (Community)

A standalone local Widget Builder for XENEON-style `.icuewidget` packages.

## The UX goal

Upload a `.icuewidget` file and immediately see it rendered, validated, and settings-enabled.

## Features

- Direct `.icuewidget` upload
- Auto-extract and auto-load `index.html`
- Automatic layout inference when `manifest.json` includes layout entries
- Auto-validation on upload
- Uses official `icuewidget validate` CLI when installed
- Falls back to built-in checks aligned with iCUE widget specification requirements
- Official XENEON EDGE viewport presets
- Automatic fit scaling

## Quick Start

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:8090](http://127.0.0.1:8090)

## Validation Behavior

On each upload, the app runs:

1. `icuewidget validate <extracted-widget-dir>` if the CLI is available on your machine.
2. Built-in checks for required files and key manifest fields.

Validation results are shown in the UI with pass/warn/fail status.

## Notes

- Best on Chrome/Edge/Safari with Service Worker support.
- External network access is blocked by default in local preview for safety.
- Widgets that depend on remote feeds/APIs (for example Readit or RSS Feed Reader) may require the optional local proxy flow and still depend on remote CORS/content behavior.

## Hosted network preview

When deployed to Cloudflare Pages, the app supports hosted `.icuewidget` upload/render/network preview. It includes:

- `/api/proxy?url=<encoded_url>` for opt-in external RSS/JSON fetch preview
- `/api/validate` for hosted-lite validation messaging

Hosted validation is intentionally limited and does not run the `icuewidget` CLI. Full package validation runs locally through `server.js` when you use `npm run dev`.

**It is off by default.** Enable it per session via the **Network Preview** toggle in the Settings tab. Only enable it for feeds and APIs you trust.

See [`docs/CLOUDFLARE-NETWORK-PREVIEW.md`](docs/CLOUDFLARE-NETWORK-PREVIEW.md) for deployment details and security limits.

## Repository Layout

- `index.html`: Widget Builder shell and controls
- `styles.css`: app and viewport styling
- `preview.js`: upload, extraction, layout inference, settings bridge, library persistence, validation UI updates
- `sw.js`: in-browser virtual file serving for uploaded widgets
- `server.js`: local static server + validation API

## License

MIT

Author: Daniel Mayhe (@danielmayhe)
