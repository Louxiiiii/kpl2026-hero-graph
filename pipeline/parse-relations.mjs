
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "pipeline", "raw", "relations");
const OUT = path.join(ROOT, "pipeline", "raw", "relations.json");
const gbk = new TextDecoder("gbk");

function text(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

const result = {};
let total = { partners: 0, counters: 0, counteredBy: 0 };

for (const file of fs.readdirSync(DIR)) {
  if (!file.endsWith(".html")) continue;
  const heroId = file.replace(/\.html$/, "");
  const html = gbk.decode(fs.readFileSync(path.join(DIR, file)));

  const anchor = html.indexOf("英雄关系</h3>");
  if (anchor < 0) continue;
  const block = html.slice(anchor, anchor + 12000);

  // 切成三段：最佳搭档 / 压制英雄 / 被压制英雄
  const chunks = block.split('<div class="hero-info l info"').slice(1);
  if (chunks.length < 3) continue;

  const titles = ["partners", "counters", "counteredBy"];
  const rec = {};
  chunks.slice(0, 3).forEach((chunk, i) => {
    const titleText = text((chunk.match(/<div class="hero-f1[^"]*">([\s\S]*?)<\/div>/) || [])[1] || "");
    const ids = Array.from(chunk.matchAll(/href="(\d+)\.shtml"/g)).map((m) => m[1]);
    const descBlock = (chunk.match(/<div class="hero-list-desc">([\s\S]*?)<\/div>\s*<\/div>/) || [])[1] || "";
    const reasons = Array.from(descBlock.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)).map((m) => text(m[1]));

    const list = [];
    const seen = new Set();
    ids.forEach((id, k) => {
      if (seen.has(id)) return;
      seen.add(id);
      let reason = reasons[k] || "";
      // 去掉「英雄名：」前缀
      reason = reason.replace(/^[^：:]{2,12}[：:]\s*/, "").trim();
      list.push({ id, reason });
    });
    if (!list.length) return;
    rec[titles[i]] = list;
    total[titles[i]] += list.length;
  });

  if (Object.keys(rec).length) result[heroId] = rec;
}

fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), heroes: result }), "utf8");
const heroes = Object.keys(result).length;
console.log("heroes with official relations:", heroes);
console.log("partners", total.partners, "counters", total.counters, "counteredBy", total.counteredBy);
const sample = result["105"];
console.log("sample 105:", JSON.stringify(sample).slice(0, 600));
