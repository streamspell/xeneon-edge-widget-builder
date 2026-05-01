# XENEON EDGE Widget Builder

XENEON EDGE Widget Builder is a local or hosted developer preview tool for `.icuewidget` packages. It helps you upload, inspect, validate, and preview widget packages against XENEON EDGE viewport presets.

## What It Does

- Upload `.icuewidget` packages
- Preview official XENEON EDGE viewports
- Validate package structure and manifest data
- Emulate widget settings in preview
- Save uploaded widgets in a local IndexedDB library
- Use an opt-in network preview proxy for feed/API widgets
- Deploy cleanly to Cloudflare Pages with `functions/api/proxy.js`

## Run Locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:8090](http://127.0.0.1:8090)

## Security Notes

- Widget iframe sandbox is `allow-scripts` only.
- `allow-same-origin` is intentionally not enabled.
- Network Preview is OFF by default each session.
- The proxy blocks localhost, private/internal ranges, and metadata targets.

## Cloudflare Pages Deployment

This project can deploy as a static Pages app with a Pages Function for network preview.

Recommended settings:

- Project name: `xeneon-edge-widget-builder`
- Production branch: `main`
- Build command: none
- Build output directory: `./`
- Root directory: repository root
- Functions directory: `functions/`

After deploy, the proxy endpoint is:

- `/api/proxy?url=<encoded_url>`

See [docs/CLOUDFLARE-NETWORK-PREVIEW.md](docs/CLOUDFLARE-NETWORK-PREVIEW.md) for details.

## Known Limitations

- This is not official CORSAIR software.
- Preview behavior may not perfectly match the iCUE runtime.
- Network proxy is development-preview functionality.
- Some widgets may require compatibility shims.

## Sample Widgets

Sample widgets are provided for local testing only. Verify redistribution rights before publishing third-party packages.

This public release excludes third-party sample `.icuewidget` files by default.

## License

MIT

## Author

Daniel Mayhe / @danielmayhe

StreamSpell attribution: originated from StreamSpell XENEON EDGE tooling work and released here as a standalone public builder.
