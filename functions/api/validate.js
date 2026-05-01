const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function estimateDecodedBytes(base64) {
  const clean = String(base64 || '').replace(/\s+/g, '');
  if (!clean) return 0;

  let padding = 0;
  if (clean.endsWith('==')) padding = 2;
  else if (clean.endsWith('=')) padding = 1;
  return Math.floor((clean.length * 3) / 4) - padding;
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed.' });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON payload.' });
  }

  const fileName = payload?.fileName;
  const base64 = payload?.base64;
  if (typeof fileName !== 'string' || !fileName || typeof base64 !== 'string' || !base64) {
    return jsonResponse(400, { ok: false, error: 'Invalid payload.' });
  }

  const decodedBytes = estimateDecodedBytes(base64);
  if (!Number.isFinite(decodedBytes) || decodedBytes <= 0) {
    return jsonResponse(400, { ok: false, error: 'Invalid base64 widget payload.' });
  }
  if (decodedBytes > MAX_UPLOAD_BYTES) {
    return jsonResponse(413, { ok: false, error: 'Upload exceeds size limit.' });
  }

  return jsonResponse(200, {
    ok: true,
    source: 'hosted-lite',
    cliAvailable: false,
    errors: [],
    warnings: [
      'Hosted validation is limited. Run the local builder with npm run dev for full package validation.'
    ],
    summary: {
      fileCount: null,
      widgetName: null,
      widgetVersion: null
    }
  });
}
