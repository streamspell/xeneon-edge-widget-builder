const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 12;
const WIDGET_CACHE_NAME = 'xeneon-widget-preview-v1';
const SESSION_INDEX_URL = '/__widget_meta__/index.json';
const WIDGET_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function logServiceWorkerTelemetry(message, ...details) {
  console.log('[XENEON sw]', message, ...details);
}

function textResponse(status, body) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function cacheUrl(pathname) {
  return new URL(pathname, self.location.origin).toString();
}

function sessionRequest(sessionId, safePath) {
  return new Request(cacheUrl(`/__widget__/${sessionId}/${safePath}`));
}

function indexRequest() {
  return new Request(cacheUrl(SESSION_INDEX_URL));
}

async function readSessionIndex(cache) {
  const response = await cache.match(indexRequest());
  if (!response) return { sessions: {} };

  try {
    const parsed = await response.json();
    if (!parsed || typeof parsed !== 'object' || typeof parsed.sessions !== 'object' || parsed.sessions == null) {
      return { sessions: {} };
    }
    return parsed;
  } catch {
    return { sessions: {} };
  }
}

async function writeSessionIndex(cache, index) {
  await cache.put(indexRequest(), new Response(JSON.stringify(index), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  }));
}

async function deleteSessionEntries(cache, sessionId, sessionMeta) {
  const files = Array.isArray(sessionMeta?.files) ? sessionMeta.files : [];
  await Promise.all(files.map((filePath) => cache.delete(sessionRequest(sessionId, filePath))));
}

async function pruneSessions(cache, index) {
  const now = Date.now();
  const sessions = Object.entries(index.sessions || {})
    .filter(([id, session]) => id && session && typeof session.createdAt === 'number')
    .sort((a, b) => a[1].createdAt - b[1].createdAt);

  const expiredIds = new Set();
  for (const [sessionId, sessionMeta] of sessions) {
    if (now - sessionMeta.createdAt > SESSION_TTL_MS) {
      expiredIds.add(sessionId);
    }
  }

  while (sessions.length - expiredIds.size > MAX_SESSIONS) {
    const next = sessions.find(([sessionId]) => !expiredIds.has(sessionId));
    if (!next) break;
    expiredIds.add(next[0]);
  }

  if (!expiredIds.size) return index;

  for (const sessionId of expiredIds) {
    await deleteSessionEntries(cache, sessionId, index.sessions?.[sessionId]);
    delete index.sessions[sessionId];
  }

  await writeSessionIndex(cache, index);
  return index;
}

function decodeSafe(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

function isSafeArchivePath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath) return false;
  const decoded = decodeSafe(rawPath);
  if (decoded == null) return false;

  const normalized = decoded.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!normalized) return false;
  if (normalized.startsWith('/')) return false;
  if (/^[A-Za-z]:\//.test(normalized)) return false;

  const lower = normalized.toLowerCase();
  if (lower.includes('%2e') || lower.includes('%2f') || lower.includes('%5c')) return false;

  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) return false;
  if (parts.some((part) => part === '.' || part === '..')) return false;

  return true;
}

function normalizeArchivePath(rawPath) {
  if (!isSafeArchivePath(rawPath)) return null;
  return decodeSafe(rawPath).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const cache = await caches.open(WIDGET_CACHE_NAME);
    await pruneSessions(cache, await readSessionIndex(cache));
  })());
});

self.addEventListener('message', async (event) => {
  const data = event.data || {};
  if (data.type !== 'REGISTER_WIDGET' || !data.sessionId || !Array.isArray(data.files)) {
    return;
  }

  event.waitUntil((async () => {
    const cache = await caches.open(WIDGET_CACHE_NAME);
    const index = await pruneSessions(cache, await readSessionIndex(cache));
    const createdAt = Date.now();
    const sessionFiles = [];

    for (const file of data.files) {
      const safePath = normalizeArchivePath(file.path || '');
      if (!safePath || !file.base64) continue;

      const binary = atob(file.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

      await cache.put(sessionRequest(data.sessionId, safePath), new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': file.contentType || 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': WIDGET_CSP,
          'X-Content-Type-Options': 'nosniff'
        }
      }));
      sessionFiles.push(safePath);
    }

    index.sessions[data.sessionId] = { createdAt, files: sessionFiles };
    await pruneSessions(cache, index);
    await writeSessionIndex(cache, index);
    logServiceWorkerTelemetry('Widget session registered in Cache Storage.', data.sessionId, sessionFiles.length);

    if (event.source && event.source.postMessage) {
      event.source.postMessage({ type: 'REGISTERED_WIDGET', sessionId: data.sessionId });
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const marker = '/__widget__/';
  const idx = url.pathname.indexOf(marker);
  if (idx === -1) return;

  const rest = url.pathname.slice(idx + marker.length);
  const firstSlash = rest.indexOf('/');
  if (firstSlash === -1) {
    event.respondWith(textResponse(404, 'Widget asset not available. The Service Worker must serve /__widget__ assets from Cache Storage.'));
    return;
  }

  const sessionId = rest.slice(0, firstSlash);
  const rawPath = rest.slice(firstSlash + 1);
  const safePath = normalizeArchivePath(rawPath);
  if (!safePath) {
    event.respondWith(textResponse(403, 'Forbidden'));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(WIDGET_CACHE_NAME);
    await pruneSessions(cache, await readSessionIndex(cache));
    const response = await cache.match(sessionRequest(sessionId, safePath));
    return response || textResponse(404, 'Widget asset not available. The Service Worker must serve /__widget__ assets from Cache Storage.');
  })());
});
