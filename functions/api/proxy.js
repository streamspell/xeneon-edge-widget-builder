// Cloudflare Pages Function: GET /api/proxy?url=<encoded>
//
// SSRF protection is hostname-pattern blocking only — no DNS resolution is
// available in Cloudflare Workers. This proxy is designed for development
// preview use, not as a hardened production proxy. The Cloudflare Workers
// sandbox provides additional isolation, but the SSRF guarantees here are
// weaker than the local server (which validates resolved IPs via DNS).
//
// Redirects are blocked. Use the final URL directly if a feed redirects.

const PROXY_TIMEOUT_MS = 8000;
const PROXY_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PREVIEW_HEADER = 'x-xeneon-network-preview';
const ALLOWED_ACCEPT =
  'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/plain;q=0.8';

function jsonError(status, message) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function isAllowedProxyContentType(contentType) {
  const value = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  return /^(application\/(rss\+xml|atom\+xml|xml|json|[\w.+-]+\+xml|[\w.+-]+\+json)|text\/(plain|xml|json))$/.test(value);
}

function isRedditJsonEndpoint(url) {
  const hostname = String(url?.hostname || '').toLowerCase();
  if (hostname !== 'reddit.com' && hostname !== 'www.reddit.com') return false;
  return /(?:\/\.json|\.json)$/i.test(String(url?.pathname || ''));
}

function isPrivateIPv4(host) {
  const parts = host.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(host) {
  const n = host.toLowerCase();
  return (
    n === '::1' || n === '::' || n.startsWith('fe80:') ||
    n.startsWith('fc') || n.startsWith('fd') ||
    n === '::ffff:127.0.0.1' || n === '::ffff:169.254.169.254'
  );
}

function isBlockedHost(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;

  // URL API wraps IPv6 in brackets: [::1]
  if (h.startsWith('[') && h.endsWith(']')) return isPrivateIPv6(h.slice(1, -1));

  // IPv4 dotted-decimal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return isPrivateIPv4(h);

  return false;
}

async function readProxyResponse(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > PROXY_MAX_RESPONSE_BYTES) {
      throw new Error('Proxy response exceeded size limit.');
    }
    return text;
  }

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > PROXY_MAX_RESPONSE_BYTES) throw new Error('Proxy response exceeded size limit.');
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== 'GET') {
    return jsonError(405, 'Method not allowed.');
  }

  // Lightweight marker to avoid effortless open-proxy abuse.
  // This is NOT a security boundary — do not rely on it as authentication.
  if (request.headers.get(PREVIEW_HEADER) !== '1') {
    return jsonError(403, 'Forbidden.');
  }

  const reqUrl = new URL(request.url);
  const rawUrl = reqUrl.searchParams.get('url') || '';
  if (!rawUrl) {
    return jsonError(400, 'Missing url parameter.');
  }

  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    return jsonError(400, 'Invalid proxy URL.');
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return jsonError(400, 'Proxy only allows http and https URLs.');
  }

  if (isBlockedHost(target.hostname)) {
    return jsonError(403, 'Blocked proxy destination.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method: 'GET',
      headers: { Accept: ALLOWED_ACCEPT },
      redirect: 'manual',
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timer);
    return jsonError(502, error?.name === 'AbortError' ? 'Proxy request timed out.' : 'Proxy request failed.');
  } finally {
    clearTimeout(timer);
  }

  // Block all redirects — the destination cannot be validated in CF Workers.
  if (upstream.status >= 300 && upstream.status < 400) {
    return jsonError(502, 'Proxy target redirected. Redirects are not followed for security reasons. Use the final URL directly.');
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (!isAllowedProxyContentType(contentType)) {
    if (/^text\/html(?:$|;)/i.test(contentType) && isRedditJsonEndpoint(target)) {
      return jsonError(415, 'Reddit returned HTML instead of JSON. Check the Reddit API URL or try adding /.json.');
    }
    return jsonError(415, `Blocked proxy content type: ${contentType || 'unknown'}`);
  }

  let body;
  try {
    body = await readProxyResponse(upstream);
  } catch (error) {
    return jsonError(502, error.message || 'Proxy read failed.');
  }

  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type': contentType || 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
