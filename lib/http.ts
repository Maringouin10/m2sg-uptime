export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=10, stale-while-revalidate=20",
      ...CORS_HEADERS,
    },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS, "access-control-max-age": "86400" } });
}
