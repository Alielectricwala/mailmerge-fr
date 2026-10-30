// Vercel Function entry: the whole Express API (plus unsubscribe pages and the sending tick).
// The server is compiled to dist/server by the build step (scripts/vercel-build.mjs) before
// Vercel bundles this function, so this file stays plain JavaScript.
//
// vercel.json rewrites /api/*, /u/* and /health here and passes the original path as ?__path=…,
// so routing works whether or not the platform keeps the original URL in req.url.
import { createApp } from "../dist/server/server/app.js";

const app = createApp();

export default function handler(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const original = url.searchParams.get("__path");
  if (original) {
    url.searchParams.delete("__path");
    const query = url.searchParams.toString();
    req.url = `${original.startsWith("/") ? original : `/${original}`}${query ? `?${query}` : ""}`;
  }
  return app(req, res);
}
