function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed.' });
  }

  return jsonResponse(200, {
    ok: true,
    source: 'hosted-noop',
    message: 'Hosted preview uses Service Worker Cache Storage for widget assets.'
  });
}
