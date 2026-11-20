
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RAW = path.join(ROOT, "pipeline", "raw");
const OUT = path.join(ROOT, "data.js");

let ICON_EXT = {};
try { ICON_EXT = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "icon-ext.json"), "utf8")); } catch {}
const iconPath = (id) => "assets/hero/" + id + "." + (ICON_EXT[String(id)] || "jpg");

const POS_COLOR = { top: "#ef4444", jungle: "#f97316", mid: "#a855f7", adc: "#3b82f6", sup: "#22c55e", unk: "#8a97a5" };
const POS_NAME = { top: "对抗路", jungle: "打野", mid: "中路", adc: "发育路", sup: "游走", unk: "摇摆" };
const POS_LANE = { top: "对抗路", jungle: "打野", mid: "中路", adc: "发育路", sup: "游走" };
const POS_LIST = ["top", "mid", "adc", "jungle", "sup"];

const LEAGUES = [
  { id: "20260001", short: "春季赛", name: "2026 KPL 春季赛" },
  { id: "20260002", short: "挑战者杯", name: "2026 KPL 挑战者杯" },
  { id: "20260003", short: "夏季赛", name: "2026 KPL 夏季赛" },
  { id: "20260004", short: "年度总决赛", name: "2026 KPL 年度总决赛" },
];

// ---------------- 读取官方逐局数据 ----------------
const leagues = [];
for (const L of LEAGUES) {
  const f = path.join(RAW, "official-" + L.id + ".json");
  if (!fs.existsSync(f)) throw new Error("missing " + f);
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const battles = [];
  for (const m of j.matches) {
    for (const b of m.battles) {
      if (b.win_camp !== 1 && b.win_camp !== 2) continue;
      if (!b.picks || b.picks["1"].length !== 5 || b.picks["2"].length !== 5) continue;
      battles.push({ ...b, match: m });
    }
  }
  leagues.push({ ...L, series: j.matches.length, battles, generated: j.fetched_at });
}

// ---------------- 英雄与选手聚合 ----------------
const heroes = new Map();
function hero(id) {
  id = String(id);
  if (!heroes.has(id)) heroes.set(id, {
    id, picks: 0, wins: 0, bans: 0,
    names: new Map(), lanes: new Map(), players: new Map(), perSeason: {},
  });
  return heroes.get(id);
}
function inc(map, k) { if (!k) return; map.set(k, (map.get(k) || 0) + 1); }

let totalBattles = 0, totalSeries = 0, banBattles = 0;
const games = [];

for (const L of leagues) {
  totalBattles += L.battles.length;
  totalSeries += L.series;
  for (const b of L.battles) {
    if (((b.bans && b.bans["1"] ? b.bans["1"].length : 0) + (b.bans && b.bans["2"] ? b.bans["2"].length : 0)) > 0) banBattles++;

    const sides = { 1: [], 2: [] };
    for (const camp of ["1", "2"]) {
      const isWin = String(b.win_camp) === camp;
      for (const p of b.picks[camp]) {
        const h = hero(p.heroId);
        inc(h.names, p.name);
        inc(h.lanes, p.pos);
        h.picks++; if (isWin) h.wins++;
        const ps = h.perSeason[L.id] || (h.perSeason[L.id] = { picks: 0, wins: 0, bans: 0 });
        ps.picks++; if (isWin) ps.wins++;
        if (p.player) {
          let pl = h.players.get(p.player);
          if (!pl) h.players.set(p.player, (pl = { games: 0, wins: 0 }));
          pl.games++; if (isWin) pl.wins++;
        }
        sides[camp].push({ id: String(p.heroId), pos: p.pos });
      }
      for (const banId of (b.bans && b.bans[camp]) || []) {
        const h = hero(banId);
        h.bans++;
        const ps = h.perSeason[L.id] || (h.perSeason[L.id] = { picks: 0, wins: 0, bans: 0 });
        ps.bans++;
      }
    }
    games.push({ league: L.id, a: sides["1"], b: sides["2"], winner: String(b.win_camp) });
  }
}

// ---------------- 同路对位 ----------------
const key2 = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
const laneH2H = new Map();
for (const g of games) {
  for (const pos of POS_LIST) {
    const A = g.a.find((x) => x.pos === pos), B = g.b.find((x) => x.pos === pos);
    if (!A || !B || A.id === B.id) continue;
    const k = key2(A.id, B.id);
    let rec = laneH2H.get(k);
    if (!rec) laneH2H.set(k, (rec = { a: A.id < B.id ? A.id : B.id, b: A.id < B.id ? B.id : A.id, games: 0, aWins: 0, pos }));
    rec.games++;
    if ((A.id === rec.a && g.winner === "1") || (A.id === rec.b && g.winner === "2")) rec.aWins++;
  }
}

const MIN_PAIR_GAMES = 4;
const SMOOTH = 2;
const laneEdges = [];
for (const rec of laneH2H.values()) {
  const adjA = (rec.aWins + SMOOTH) / (rec.games + SMOOTH * 2);
  const adj = Math.max(adjA, 1 - adjA);
  if (rec.games < MIN_PAIR_GAMES || adj < 0.55) continue;
  const dom = adjA >= 0.5 ? rec.a : rec.b;
  const sub = adjA >= 0.5 ? rec.b : rec.a;
  const wins = adjA >= 0.5 ? rec.aWins : rec.games - rec.aWins;
  const strength = (adj >= 0.68 || (rec.games >= 40 && adj >= 0.64)) ? 3
    : (adj >= 0.60 || (rec.games >= 25 && adj >= 0.56)) ? 2 : 1;
  laneEdges.push({ dom, sub, games: rec.games, wins, losses: rec.games - wins, wr: wins / rec.games, strength, pos: rec.pos });
}

// ---------------- 同队搭档 ----------------
const duo = new Map();
for (const g of games) {
  for (const camp of ["a", "b"]) {
    const ids = g[camp].map((x) => x.id).sort();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const k = key2(ids[i], ids[j]);
      let rec = duo.get(k);
      if (!rec) duo.set(k, (rec = { a: ids[i], b: ids[j], games: 0, wins: 0 }));
      rec.games++;
      if ((camp === "a" && g.winner === "1") || (camp === "b" && g.winner === "2")) rec.wins++;
    }
  }
}
const MIN_DUO_GAMES = 14;
const duoEdges = [];
for (const rec of duo.values()) {
  if (rec.games < MIN_DUO_GAMES) continue;
  const wr = rec.wins / rec.games;
  if (wr < 0.45) continue;
  const strength = ((rec.games >= 20 && wr >= 0.64) || wr >= 0.70) ? 3
    : (wr >= 0.55 || (rec.games >= 35 && wr >= 0.50)) ? 2 : 1;
  duoEdges.push({ a: rec.a, b: rec.b, games: rec.games, wins: rec.wins, wr, strength });
}

// ---------------- 英雄列表 ----------------
const pct = (x) => (x * 100).toFixed(1);
function topKey(map, filter) {
  let best = null, bestN = -1;
  for (const [k, n] of map) { if (filter && !filter(k)) continue; if (n > bestN) { best = k; bestN = n; } }
  return best;
}
const list = [...heroes.values()].map((h) => {
  const name = topKey(h.names) || h.id;
  const lane = topKey(h.lanes) || "unk";
  let bestPlayer = "", bestPlayerWinRate = null, bestPlayerGames = 0;
  const all = [...h.players.entries()].map(([p, s]) => ({ p, ...s }));
  const cands = all.filter((c) => c.games >= 12);
  // 有足够样本时按胜率选；不足时退回「出场最多」，避免 6 局 6 胜被当成最佳
  if (cands.length) cands.sort((x, y) => (y.wins / y.games) - (x.wins / x.games) || y.games - x.games);
  else all.sort((x, y) => y.games - x.games || (y.wins / y.games) - (x.wins / x.games));
  const pick = cands.length ? cands[0] : all[0];
  const heroGames = Math.round(h.picks / 2);
  if (pick && heroGames >= 10) {
    bestPlayer = pick.p; bestPlayerWinRate = pick.wins / pick.games; bestPlayerGames = pick.games;
  }
  return {
    id: h.id, name, pos: lane, posName: POS_NAME[lane], color: POS_COLOR[lane],
    picks: h.picks, wins: h.wins, bans: h.bans,
    winRate: h.picks ? +(h.wins / h.picks).toFixed(4) : 0,
    banRate: banBattles ? +(h.bans / banBattles).toFixed(4) : 0,
    pickGames: Math.round(h.picks / 2),
    lowSample: Math.round(h.picks / 2) < 10,
    perSeason: h.perSeason,
    bestPlayer, bestPlayerWinRate: bestPlayerWinRate == null ? null : +bestPlayerWinRate.toFixed(4), bestPlayerGames,
    icon: iconPath(h.id),
    tier: "T3", strengthScore: 0,
    counters: [], counteredBy: [], partners: [],
    mechCounters: [], mechCounteredBy: [], mechPartners: [],
  };
}).filter((h) => h.picks > 0).sort((a, b) => b.picks - a.picks);

const byId = new Map(list.map((h) => [h.id, h]));

function counterReason(dom, sub, e) {
  const lane = POS_LANE[e.pos] || "同路";
  const w = e.wins, l = e.losses, n = e.games, p = pct(e.wr);
  if (e.strength === 3) return "2026 KPL " + lane + "同路对位 " + n + " 局，" + dom.name + "打出 " + w + " 胜 " + l + " 负（胜率 " + p + "%），是本年度最典型的一路压制。";
  if (e.strength === 2) return "2026 KPL " + lane + "同路对位 " + n + " 局，" + dom.name + "取得 " + w + " 胜 " + l + " 负（胜率 " + p + "%），对线期与团战容错都优于" + sub.name + "。";
  return "2026 KPL " + lane + "同路对位 " + n + " 局，" + dom.name + "略占上风（" + w + " 胜 " + l + " 负，胜率 " + p + "%）。";
}
function synergyReason(a, b, e) {
  return "2026 KPL 同队出场 " + e.games + " 局，" + a.name + " + " + b.name + " 搭档胜率 " + pct(e.wr) + "%（" + e.wins + " 胜 " + (e.games - e.wins) + " 负），是赛场验证过的高频组合。";
}

for (const e of laneEdges) {
  const dom = byId.get(e.dom), sub = byId.get(e.sub);
  if (!dom || !sub) continue;
  const base = { source: "赛场", offmeta: Math.round(sub.picks / 2) < 20, games: e.games, winRate: +e.wr.toFixed(4), strength: e.strength };
  dom.counters.push({ id: sub.id, name: sub.name, reason: counterReason(dom, sub, e), icon: sub.icon, ...base });
  sub.counteredBy.push({ id: dom.id, name: dom.name, reason: counterReason(dom, sub, e), icon: dom.icon, ...base });
}
for (const e of duoEdges) {
  const A = byId.get(e.a), B = byId.get(e.b);
  if (!A || !B) continue;
  const base = { source: "赛场", games: e.games, winRate: +e.wr.toFixed(4), strength: e.strength };
  A.partners.push({ id: B.id, name: B.name, reason: synergyReason(A, B, e), icon: B.icon, ...base });
  B.partners.push({ id: A.id, name: A.name, reason: synergyReason(A, B, e), icon: A.icon, ...base });
}
// ---------------- 机制关系（官方英雄资料「英雄关系」） ----------------
const mechMeta = { heroes: 0, partners: 0, counters: 0, counteredBy: 0, external: 0, generatedAt: null, source: "王者荣耀官网 · 英雄资料「英雄关系」" };
const relPath = path.join(RAW, "relations.json");
if (fs.existsSync(relPath)) {
  const rel = JSON.parse(fs.readFileSync(relPath, "utf8"));
  mechMeta.generatedAt = rel.generatedAt;
  // 官网关系里有一部分指向「未在 2026 KPL 出场」的英雄，也一并展示（只读，点不进详情）
  let nameMap = new Map();
  const heroListPath = path.join(RAW, "herolist.json");
  if (fs.existsSync(heroListPath)) {
    for (const item of JSON.parse(fs.readFileSync(heroListPath, "utf8"))) {
      nameMap.set(String(item.ename), item.cname);
    }
  }
  const pushMech = (target, other, reason, rawId) => {
    const id = other ? other.id : String(rawId);
    if (target.some((x) => x.id === id)) return;
    if (other) {
      target.push({ id, name: other.name, reason, source: "机制", strength: 2, games: null, winRate: null, mech: true, icon: other.icon });
    } else {
      const name = nameMap.get(id);
      if (!name) return;
      mechMeta.external++;
      target.push({
        id, name, reason, source: "机制", strength: 2, games: null, winRate: null,
        mech: true, external: true, icon: iconPath(id),
      });
    }
  };
  for (const [hid, rec] of Object.entries(rel.heroes)) {
    const h = byId.get(String(hid));
    if (!h) continue;
    mechMeta.heroes++;
    for (const it of rec.partners || []) { pushMech(h.mechPartners, byId.get(String(it.id)), it.reason, it.id); if (byId.has(String(it.id))) mechMeta.partners++; }
    for (const it of rec.counters || []) { pushMech(h.mechCounters, byId.get(String(it.id)), it.reason, it.id); if (byId.has(String(it.id))) mechMeta.counters++; }
    for (const it of rec.counteredBy || []) { pushMech(h.mechCounteredBy, byId.get(String(it.id)), it.reason, it.id); if (byId.has(String(it.id))) mechMeta.counteredBy++; }
  }
}

// 官方关系是「以某个英雄为主角」写的；新英雄没有资料页，但常作为别人的对手出现。
// 这里做一次对称补全：A 压制 B ⇒ B 的被压制里补上 A（搭档同理），让每个英雄都能看到双向关系。
(function symmetricMech() {
  const addBack = (target, from, pool) => {
    if (!from || target.some((x) => x.id === from.id)) return 0;
    target.push(Object.assign({}, pool, { id: from.id, name: from.name, icon: from.icon }));
    return 1;
  };
  let added = 0;
  for (const h of list) {
    for (const r of h.mechCounters.slice()) {
      const o = byId.get(r.id);
      if (o) added += addBack(o.mechCounteredBy, h, r);
    }
    for (const r of h.mechCounteredBy.slice()) {
      const o = byId.get(r.id);
      if (o) added += addBack(o.mechCounters, h, r);
    }
    for (const r of h.mechPartners.slice()) {
      const o = byId.get(r.id);
      if (o) added += addBack(o.mechPartners, h, r);
    }
  }
  mechMeta.symmetric = added;
})();

// ---------------- 强度梯度（T0~T3） ----------------
(function strengthTiers() {
  const maxBan = Math.max(...list.map((h) => h.banRate || 0), 1e-6);
  const maxPick = Math.max(...list.map((h) => (h.picks / 2) / totalBattles), 1e-6);
  for (const h of list) {
    const banN = (h.banRate || 0) / maxBan;
    const pickN = ((h.picks / 2) / totalBattles) / maxPick;
    const wr = (h.winRate - 0.45) / 0.10;
    const wrN = Math.max(0, Math.min(1, wr));
    h.strengthScore = +(0.45 * banN + 0.35 * pickN + 0.20 * wrN).toFixed(4);
  }
  const ranked = [...list].sort((a, b) => b.strengthScore - a.strengthScore);
  const n = ranked.length;
  ranked.forEach((h, i) => {
    const q = i / n;
    h.tier = q < 0.10 ? "T0" : q < 0.30 ? "T1" : q < 0.60 ? "T2" : "T3";
  });
})();

for (const h of list) {
  const sort = (arr) => arr.sort((x, y) => y.strength - x.strength || (y.games || 0) - (x.games || 0)).slice(0, 8);
  h.counters = sort(h.counters);
  h.counteredBy = sort(h.counteredBy);
  h.partners = sort(h.partners);
}

const counterEdges = [];
for (const h of list) for (const c of h.counters) {
  if (byId.has(c.id)) counterEdges.push({ source: h.id, target: c.id, strength: c.strength, games: c.games, winRate: c.winRate });
}
const synergyEdges = [];
const seen = new Set();
for (const h of list) for (const p of h.partners) {
  const k = key2(h.id, p.id);
  if (seen.has(k) || !byId.has(p.id)) continue;
  seen.add(k);
  synergyEdges.push({ source: h.id, target: p.id, strength: p.strength, games: p.games, winRate: p.winRate });
}

const meta = {
  title: "2026 KPL 英雄克制关系图谱",
  subtitle: "Honor of Kings · KPL 2026 · Hero Counter Network",
  generatedAt: new Date().toISOString(),
  heroCount: list.length,
  counterEdgeCount: counterEdges.length,
  synergyEdgeCount: synergyEdges.length,
  totalGames: totalBattles,
  statGames: totalBattles,
  lineupGames: totalBattles,
  bpGames: banBattles,
  seriesCount: totalSeries,
  seasons: leagues.map((L) => ({
    id: L.id, name: L.name, short: L.short,
    series: L.series, games: L.battles.length,
    heroStats: true, lineup: true, bp: true,
  })),
  mech: mechMeta,
  minPairGames: MIN_PAIR_GAMES,
  minDuoGames: MIN_DUO_GAMES,
  source: "KPL 官方赛事数据 API（prod.comp.smoba.qq.com / leaguesite）",
};

const payload = { meta, posColor: POS_COLOR, posName: POS_NAME, heroes: list, counterEdges, synergyEdges };
fs.writeFileSync(OUT, "window.DATA = " + JSON.stringify(payload) + ";\n", "utf8");
fs.writeFileSync(path.join(ROOT, "pipeline", "hero-ids.json"), JSON.stringify(list.map((h) => h.id)), "utf8");

console.log("heroes", list.length, "counterEdges", counterEdges.length, "synergyEdges", synergyEdges.length);
console.log("battles", totalBattles, "series", totalSeries, "banBattles", banBattles);
console.log("seasons", meta.seasons.map((s) => s.short + ":" + s.games).join(" "));
console.log("pos dist", list.reduce((a, h) => (a[h.pos] = (a[h.pos] || 0) + 1, a), {}));
console.log("no counters", list.filter((h) => !h.counters.length).length, "no partners", list.filter((h) => !h.partners.length).length);
console.log("picks sum", list.reduce((a, h) => a + h.picks, 0), "(expect ~" + totalBattles * 10 + ")");
