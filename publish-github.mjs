
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const API = "https://api.github.com";
const token = (process.env.GITHUB_TOKEN || process.argv[2] || "").trim();
if (!token) {
  console.error("缺少 token：请设置 GITHUB_TOKEN 或作为第一个参数传入");
  process.exit(1);
}
const REPO = (process.env.REPO_NAME || "kpl2026-hero-graph").trim();
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, opts = {}) {
  const res = await fetch(API + pathname, {
    ...opts,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "kpl2026-publisher",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

const me = await api("/user");
if (me.status !== 200) {
  console.error("token 校验失败：" + me.status + " " + JSON.stringify(me.data).slice(0, 200));
  process.exit(2);
}
const login = me.data.login;
console.log("账号：" + login);

// 1) 仓库
const created = await api("/user/repos", {
  method: "POST",
  body: JSON.stringify({
    name: REPO,
    private: false,
    auto_init: false,
    has_issues: false,
    has_wiki: false,
    description: "2026 KPL 英雄克制关系图谱 · 114 位英雄 / 258 条同路对位克制 / 1567 小局官方逐局数据",
  }),
});
if (created.status === 201) console.log("✓ 仓库已创建");
else if (created.status === 422) console.log("· 仓库已存在，改为更新文件");
else { console.error("建仓库失败：" + created.status + " " + JSON.stringify(created.data).slice(0, 300)); process.exit(3); }

// 2) 文件
async function putFile(remote, localPath, message) {
  const buf = fs.readFileSync(localPath);
  // 与远端比对 git blob sha，内容没变就不产生多余提交
  const blob = crypto.createHash("sha1").update("blob " + buf.length + "\u0000").update(buf).digest("hex");
  const body = { message, content: buf.toString("base64"), branch: "main" };
  const cur = await api("/repos/" + login + "/" + REPO + "/contents/" + remote);
  if (cur.status === 200 && cur.data && cur.data.sha === blob) {
    console.log("· " + remote + " 未变化，跳过");
    return;
  }
  if (cur.status === 200 && cur.data && cur.data.sha) body.sha = cur.data.sha;
  const r = await api("/repos/" + login + "/" + REPO + "/contents/" + remote, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(remote + " 上传失败 " + r.status + " " + JSON.stringify(r.data).slice(0, 240));
  }
  console.log("✓ " + remote + "  " + (buf.length / 1024 / 1024).toFixed(2) + " MB");
}

const empty = path.join(ROOT, ".publish-empty");
fs.writeFileSync(empty, "");

await putFile("index.html", path.join(ROOT, "kpl2026-web.html"), "deploy: 单文件站点（114 英雄 / 258 克制 / 334 搭档 / 1567 小局）");
const readmeCandidates = [path.join(ROOT, "..", "kpl2026-pages", "README.md"), path.join(ROOT, "README.md")];
const readmePath = readmeCandidates.find((f) => fs.existsSync(f));
if (readmePath) await putFile("README.md", readmePath, "docs: 项目说明");
await putFile(".nojekyll", empty, "chore: 关闭 Jekyll 处理");
fs.unlinkSync(empty);

// 3) Pages
const enable = await api("/repos/" + login + "/" + REPO + "/pages", {
  method: "POST",
  body: JSON.stringify({ source: { branch: "main", path: "/" } }),
});
if (enable.status === 201) console.log("✓ Pages 已开启（main / root）");
else if (enable.status === 409 || enable.status === 422) {
  const upd = await api("/repos/" + login + "/" + REPO + "/pages", {
    method: "PUT",
    body: JSON.stringify({ source: { branch: "main", path: "/" } }),
  });
  console.log("· Pages 已存在，配置更新 " + upd.status);
} else {
  console.log("! Pages 开启返回 " + enable.status + " " + JSON.stringify(enable.data).slice(0, 200));
}

// 4) 等构建
const siteUrl = "https://" + login.toLowerCase() + ".github.io/" + REPO + "/";
let built = false;
for (let i = 0; i < 25; i++) {
  await sleep(6000);
  const b = await api("/repos/" + login + "/" + REPO + "/pages/builds/latest");
  const st = b.data && b.data.status;
  console.log("  构建状态：" + (st || b.status));
  if (st === "built") { built = true; break; }
  if (st === "errored") break;
}

// 5) 验证线上
let ok = false;
for (let i = 0; i < 8; i++) {
  try {
    const r = await fetch(siteUrl, { redirect: "follow" });
    if (r.status === 200) {
      const html = await r.text();
      const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
      console.log("✓ 线上可访问：" + siteUrl + "  " + html.length + " 字节");
      console.log("  标题：" + title);
      ok = true;
      break;
    }
  } catch (e) {}
  await sleep(5000);
}

console.log("");
console.log("仓库地址：https://github.com/" + login + "/" + REPO);
console.log("网站地址：" + siteUrl);
if (!ok) console.log("（Pages 可能还在构建，1-2 分钟后再打开网站地址）");
