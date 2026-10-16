export const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Credentials": "true",
};

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "null";
  const allowOrigin =
    allowedOrigins.length === 0
      ? origin
      : allowedOrigins.includes(origin)
        ? origin
        : "null";

  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin": allowOrigin,
    Vary: "Origin",
  };
}
