import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
const DIR = path.join(ROOT, "assets", "hero");
const out = {};
for (const f of fs.readdirSync(DIR)) {
  if (!/\.(jpg|jpeg|png|webp)$/i.test(f)) continue;
  const id = f.replace(/\.\w+$/, "");
  const p = path.join(DIR, f);
  const b = fs.readFileSync(p).subarray(0, 12);
  let ext = "jpg";
  if (b[0] === 0xff && b[1] === 0xd8) ext = "jpg";
  else if (b[0] === 0x89 && b[1] === 0x50) ext = "png";
  else if (b.toString("ascii", 0, 4) === "RIFF") ext = "webp";
  const target = path.join(DIR, id + "." + ext);
  if (path.basename(target) !== f) fs.renameSync(p, target);
  out[id] = ext;
}
fs.writeFileSync(path.join(ROOT, "pipeline", "icon-ext.json"), JSON.stringify(out), "utf8");
console.log("icons normalized", Object.keys(out).length, "png:", Object.values(out).filter((x) => x === "png").length);
