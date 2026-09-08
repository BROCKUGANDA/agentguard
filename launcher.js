/**
 * AgentGuard container entrypoint.
 *
 * Launches, inside ONE Node process:
 *   - Sidecar (Fastify, :9559)   — API + WebSocket + policy engine + audit
 *   - Dashboard (:5173)          — Vite static build + /api reverse proxy
 *
 * The dashboard build calls the sidecar through the same-origin `/api`
 * prefix, so no CORS is needed in the container: launcher rewrites
 * `/api/*` → sidecar `/*`. WebSocket clients connect straight to :9559.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Process-level safety nets — log async errors instead of crashing silently.
process.on("unhandledRejection", (reason) => {
  console.error("[agentguard] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[agentguard] uncaughtException:", err);
  if (process.env.NODE_ENV === "production") process.exit(1);
});
// Container layout: /app/sidecar/... · monorepo layout: <repo>/packages/sidecar/...
const SIDECAR_ENTRY = pathToFileURL(
  fs.existsSync(path.join(__dirname, "sidecar", "dist", "server.js"))
    ? path.join(__dirname, "sidecar", "dist", "server.js")
    : path.join(__dirname, "packages", "sidecar", "dist", "server.js")
).href;
const DASHBOARD_DIR = fs.existsSync(path.join(__dirname, "dashboard", "dist"))
  ? path.join(__dirname, "dashboard", "dist")
  : path.join(__dirname, "packages", "dashboard", "dist");

// ─── Boot sidecar ───────────────────────────────────────────────────────────
console.log("[agentguard] starting sidecar...");
const sidecar = await import(SIDECAR_ENTRY);
await sidecar.start();

const API_PORT = Number.parseInt(process.env.AGENTGUARD_PORT ?? "9559", 10);
const DASH_PORT = Number.parseInt(process.env.AGENTGUARD_DASHBOARD_PORT ?? "5173", 10);

// ─── Static dashboard ───────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Reverse-proxy /api/* → sidecar /* (same-origin, strips /api). */
function proxyToSidecar(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const targetPath = url.pathname.replace(/^\/api/, "") || "/";
  const headers = { ...req.headers, host: `127.0.0.1:${API_PORT}` };
  delete headers["connection"];
  const proxy = http.request(
    {
      hostname: "127.0.0.1",
      port: API_PORT,
      path: targetPath + url.search,
      method: req.method,
      headers,
    },
    (pRes) => {
      res.writeHead(pRes.statusCode ?? 502, pRes.headers);
      pRes.pipe(res);
    }
  );
  proxy.on("error", (err) => {
    console.error("[agentguard] /api proxy error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "sidecar unreachable" }));
    } else {
      res.end();
    }
  });
  req.pipe(proxy);
}

function serveDashboard(req, res) {
  if (req.url?.startsWith("/api")) return proxyToSidecar(req, res);

  let urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  // SPA fallback: any path without an extension → index.html
  if (!path.extname(urlPath)) urlPath = "/index.html";

  const filePath = path.join(DASHBOARD_DIR, urlPath);
  if (!filePath.startsWith(DASHBOARD_DIR)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": urlPath === "/index.html" ? "no-cache" : "public, max-age=3600",
      // ─── Security headers (OWASP recommended) ──────────────────────────
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
      // CSP: same-origin only. Google Fonts allowed for the design system; tighten for stricter deployments.
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",  // 'unsafe-inline' for Vite-injected <style> tags
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self' ws: wss:",  // ws: for the live event stream
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
      // COOP/COEP for SharedArrayBuffer + cross-origin isolation
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
    };
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

const dashServer = http.createServer(serveDashboard);

// ─── WebSocket proxy: /stream → sidecar ──────────────────────────────────────
// The dashboard connects to same-origin /stream; in the container the browser
// can't reach :9559 directly, so we proxy the WS upgrade to the sidecar.
dashServer.on("upgrade", (req, socket, head) => {
  const target = new URL(req.url ?? "/stream", `http://127.0.0.1:${API_PORT}`);
  const proxyReq = http.request({
    hostname: "127.0.0.1",
    port: API_PORT,
    path: target.pathname + target.search,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` },
  });
  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(proxyRes.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n") +
        "\r\n\r\n"
    );
    if (proxyHead.length > 0) socket.write(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
    proxySocket.on("error", () => socket.destroy());
    socket.on("error", () => proxySocket.destroy());
  });
  proxyReq.on("error", () => socket.destroy());
  if (head.length > 0) proxyReq.write(head);
  proxyReq.end();
});

dashServer.listen(DASH_PORT, "0.0.0.0", () => {
  console.log(`[agentguard] dashboard  → http://0.0.0.0:${DASH_PORT}`);
  console.log(`[agentguard] sidecar    → http://0.0.0.0:${API_PORT}`);
  console.log(`[agentguard] ready. policy file: ${process.env.AGENTGUARD_POLICY_FILE}`);
});

// ─── Graceful shutdown ──────────────────────────────────────────────────────
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    console.log(`\n[agentguard] ${sig} — shutting down`);
    dashServer.close();
    await sidecar.stop?.().catch(() => {});
    process.exit(0);
  });
}