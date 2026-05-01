export async function onRequest() {
  return new Response(
    'Widget asset not available. The Service Worker must serve /__widget__ assets from Cache Storage.',
    {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    }
  );
}
