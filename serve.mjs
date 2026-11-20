import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || "/").split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const file = path.join(ROOT, path.normalize(rel).replace(/^([/\\.]+)/, ""));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 " + rel);
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(buf);
  });
});

server.listen(PORT, HOST, () => {
  console.log("serving " + ROOT);
  console.log("  http://" + HOST + ":" + PORT + "/            (多文件版)");
  console.log("  http://" + HOST + ":" + PORT + "/kpl2026-web.html  (单文件网页版)");
});
