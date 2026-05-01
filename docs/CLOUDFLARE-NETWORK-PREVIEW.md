# Cloudflare Network Preview

The XENEON EDGE Widget Builder includes an opt-in network preview layer for testing widgets that fetch external RSS feeds or JSON APIs during development.

---

## What it does

When you deploy this app to Cloudflare Pages, the `functions/api/proxy.js` file is automatically deployed as a Pages Function. It handles:

```
GET /api/proxy?url=<encoded_url>
```

The parent app (running in the browser) intercepts `fetch()` and `XMLHttpRequest` calls from the widget iframe and routes them through this endpoint. The widget never makes direct external requests — all traffic goes through the proxy, which validates the destination and returns only allowed content types.

---

## How to deploy with Cloudflare Pages

1. Connect your repository to Cloudflare Pages.
2. The `functions/` directory is automatically detected. No build step or wrangler config is required for the proxy.
3. Deploy. The endpoint becomes available at `https://<your-pages-domain>/api/proxy`.

No KV, D1, R2, Durable Objects, or environment secrets are needed.

---

## How `/api/proxy` works

### Request

```
GET /api/proxy?url=https%3A%2F%2Frss.nytimes.com%2Fservices%2Fxml%2Frss%2Fnyt%2FWorld.xml
X-Xeneon-Network-Preview: 1
```

- `url` parameter: the encoded upstream URL to fetch
- `X-Xeneon-Network-Preview: 1` header: required marker sent by the parent app

### Successful response

The proxy returns the upstream body with:
- `Content-Type` from the upstream response
- `Cache-Control: no-store`
- `X-Content-Type-Options: nosniff`

All other upstream headers (cookies, server fingerprinting, CORS, etc.) are dropped.

### Error responses

All errors return `{"ok": false, "error": "..."}` JSON:

| Status | Cause |
|--------|-------|
| 400 | Missing or invalid `url` parameter, non-http/https protocol |
| 403 | Missing `X-Xeneon-Network-Preview` header, or blocked hostname/IP |
| 405 | Non-GET method |
| 415 | Upstream content type not in the allowlist |
| 502 | Upstream fetch failed, timed out, or size limit exceeded |
| 502 | Upstream responded with a redirect (not followed) |

---

## Security limits

### SSRF protection

The proxy blocks requests to:
- `localhost`, `*.localhost`, `*.local`
- `127.x.x.x`
- `::1` and other loopback IPv6 addresses
- `0.0.0.0`
- `10.x.x.x`
- `172.16.x.x` – `172.31.x.x`
- `192.168.x.x`
- `169.254.x.x` (link-local, including the AWS/GCP metadata service at 169.254.169.254)
- `100.64.x.x` – `100.127.x.x` (CGNAT)
- Multicast (`224+`) and broadcast (`255.255.255.255`)

**Important:** Cloudflare Workers do not expose a DNS resolution API. SSRF protection here is hostname-pattern blocking only — there is no IP re-validation after DNS resolution. The Cloudflare Workers sandbox provides additional isolation, but this proxy is designed for development preview use, not as a hardened production proxy.

### Redirect policy

Redirects are **not followed**. The proxy uses `redirect: 'manual'` and returns a `502` error if the upstream responds with a 3xx. This prevents redirect chains to unvalidated destinations.

If a feed redirects, use the final URL directly in the widget settings.

### Request forwarding

The proxy sends only:
- `Accept` header (set to the RSS/XML/JSON allowlist)

It does **not** forward:
- Cookies
- `Authorization` headers
- Any other headers from the original browser request

### `X-Xeneon-Network-Preview` header

The CF function requires this header on every request. It is sent automatically by the parent app when network preview is enabled. This is a lightweight guard against the endpoint being used as an effortless public open proxy — it is not authentication and should not be treated as a security boundary.

---

## Allowed content types

| Content type | Reason |
|---|---|
| `application/rss+xml` | RSS feeds (RSS Feed Reader widget) |
| `application/atom+xml` | Atom feeds |
| `application/xml`, `text/xml` | Generic XML feeds |
| `application/json`, `text/json` | JSON APIs (Readit widget uses Reddit's `.json` endpoints) |
| `application/*.+xml`, `application/*.+json` | Typed XML/JSON subtypes |
| `text/plain` | Plain-text feeds and fallback responses |

`text/html` is **not** allowed in v1. Both target widgets work without it:
- **RSS Feed Reader** fetches XML directly from RSS endpoints, or JSON from allorigins.win
- **Readit** fetches `reddit.com/r/{sub}/{sort}.json` which returns `application/json`

If a future widget requires `text/html`, document exactly why and add it explicitly.

---

## Why network preview is opt-in

The iframe runs under a strict Content Security Policy (`connect-src 'none'`). Without network preview enabled, widgets cannot make any external requests. This is intentional — it prevents untrusted widget code from beaconing, exfiltrating data, or loading remote scripts.

The network preview toggle is session-only and off by default. It must be explicitly enabled each session. When enabled, only GET requests to http/https URLs are proxied through `/api/proxy`. Requests to localhost, private ranges, and metadata services remain blocked at the proxy level.

---

## Known limitations

1. **No DNS IP re-validation.** The proxy validates the target hostname before the request, but cannot check the resolved IP. A hostname that resolves to a private IP will not be caught. The Cloudflare Workers sandbox mitigates some of this, but it is not a substitute for full SSRF protection.

2. **Redirects are blocked.** Any upstream 3xx response is rejected. Use the final URL directly.

3. **No streaming.** Responses are buffered up to 2 MB before being returned to the widget.

4. **Not a production proxy.** This endpoint is designed for development preview use only. Do not use it as a general-purpose proxy in production.

5. **Hostname blocking only.** Punycode, URL encoding tricks, or DNS rebinding attacks are not fully guarded against. Again: dev tool, not production hardening.

---

## What this is not

This proxy has no relationship to:
- Twitch OAuth
- iCUE account linking
- User authentication or token storage
- Cloudflare KV, D1, R2, or Durable Objects
- Any kind of persistent session management

It is a single stateless GET proxy endpoint for development preview use.
