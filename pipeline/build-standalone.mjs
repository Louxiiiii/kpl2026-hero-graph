
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const html = read("index.html");
const css = read("styles.css");
const appJs = read("app.js");
const dataJs = read("data.js");
const d3 = read(path.join("assets", "vendor", "d3.min.js"));

const payload = JSON.parse(dataJs.replace(/^window\.DATA\s*=\s*/, "").replace(/;\s*$/, ""));
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const cache = new Map();
let rawBytes = 0;
let count = 0;

function dataUri(icon) {
  if (cache.has(icon)) return cache.get(icon);
  const file = path.join(ROOT, icon);
  const ext = path.extname(file).slice(1).toLowerCase();
  const buf = fs.readFileSync(file);
  rawBytes += buf.length;
  count++;
  const uri = "data:" + (MIME[ext] || "image/jpeg") + ";base64," + buf.toString("base64");
  cache.set(icon, uri);
  return uri;
}

// 头像只挂在英雄上（每张图只出现一次）；关系项留空，运行时回落到对手英雄的头像，
// 否则同一张 base64 会在上千条关系里重复，体积会炸到 30MB。
const heroIds = new Set(payload.heroes.map((h) => h.id));
// 未出场英雄的头像单独放一张表（id → dataURI），关系项只留空，运行时按 id 查表，
// 避免同一张 base64 在 125 条关系里重复导致体积爆炸。
const externalIcons = {};
for (const h of payload.heroes) {
  if (h.icon) h.icon = dataUri(h.icon);
  for (const key of ["counters", "counteredBy", "partners", "mechCounters", "mechCounteredBy", "mechPartners"]) {
    for (const rel of h[key] || []) {
      if (!heroIds.has(rel.id) && rel.icon && !externalIcons[rel.id]) externalIcons[rel.id] = dataUri(rel.icon);
      rel.icon = "";
    }
  }
}
payload.externalIcons = externalIcons;

const inlineData = "window.DATA = " + JSON.stringify(payload) + ";";
const safe = (s) => s.replace(/<\/script/gi, "<\\/script");

let out = html;
out = out.replace(/<link rel="stylesheet" href="styles\.css">/, function () { return "<style>\n" + css + "\n</style>"; });
out = out.replace(/<script src="assets\/vendor\/d3\.min\.js"><\/script>/, function () { return "<script>\n" + safe(d3) + "\n</script>"; });
out = out.replace(/<script src="data\.js"><\/script>/, function () { return "<script>\n" + safe(inlineData) + "\n</script>"; });
out = out.replace(/<script src="app\.js"><\/script>/, function () { return "<script>\n" + safe(appJs) + "\n</script>"; });

const leftovers = [];
if (out.indexOf('href="styles.css"') >= 0) leftovers.push("styles.css");
if (out.indexOf('src="data.js"') >= 0) leftovers.push("data.js");
if (out.indexOf('src="app.js"') >= 0) leftovers.push("app.js");
if (out.indexOf('src="assets/vendor') >= 0) leftovers.push("d3");
if (out.indexOf('src="assets/hero') >= 0) leftovers.push("hero");
if (leftovers.length) throw new Error("还有未内联的引用: " + leftovers.join(","));

fs.writeFileSync(path.join(ROOT, "kpl2026-web.html"), out, "utf8");
console.log("kpl2026-web.html 生成完成");
console.log("  内联头像 " + count + " 张 / 原始 " + (rawBytes / 1024 / 1024).toFixed(2) + " MB");
console.log("  d3 " + (d3.length / 1024).toFixed(0) + " KB | data " + (inlineData.length / 1024).toFixed(0) + " KB | app " + (appJs.length / 1024).toFixed(0) + " KB");
console.log("  成品 " + (Buffer.byteLength(out) / 1024 / 1024).toFixed(2) + " MB");
