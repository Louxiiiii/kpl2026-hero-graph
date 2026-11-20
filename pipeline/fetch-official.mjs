
import fs from "node:fs";
import path from "node:path";

const BASE = "https://prod.comp.smoba.qq.com";
const ROOT = process.cwd();
const RAW = path.join(ROOT, "pipeline", "raw");
const FORCE = process.argv.includes("--force");
const CONCURRENCY = 10;

const POS_NAME = { 2: "mid", 4: "sup", 5: "jungle", 6: "top", 7: "adc", 0: "unk" };

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function getJson(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { "Accept": "application/json" } });
      clearTimeout(t);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      if (j.code !== undefined && Number(j.code) !== 200) throw new Error("code " + j.code);
      return j;
    } catch (e) {
      lastErr = e;
      await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}

async function pool(items, worker, limit) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

// 1) 赛事列表
const leaguesJson = await getJson(BASE + "/leaguesite/leagues/open");
const leagues = (leaguesJson.results || []).filter((l) => String(l.year) === "2026");
console.log("2026 leagues:", leagues.map((l) => l.league_id + " " + l.league_name).join(" | "));

for (const league of leagues) {
  const outFile = path.join(RAW, "official-" + league.league_id + ".json");
  if (!FORCE && fs.existsSync(outFile)) {
    console.log("skip (cached)", league.league_id);
    continue;
  }

  // 2) 赛程
  const matchesJson = await getJson(BASE + "/leaguesite/matches/open?league_id=" + league.league_id);
  const matches = (matchesJson.results || []).filter((m) => m.status === 2);
  console.log(league.league_id, "finished matches:", matches.length);

  // 3) 收集 battle 列表
  const battleJobs = [];
  for (const m of matches) {
    const list = (m.match_battle_video_list || [])
      .filter((b) => b.battle_id)
      .map((b) => ({ battle_id: b.battle_id, seq: Number(b.battle_seq) || 0 }));
    if (!list.length) {
      try {
        const bj = await getJson(BASE + "/leaguesite/match/battles/open?match_id=" + m.match_id);
        for (const b of bj.results || []) {
          if (b.battle_id && b.status === 2) battleJobs.push({ battle_id: b.battle_id, seq: Number(b.battle_seq) || 0, match: m });
        }
      } catch (e) { console.log("  battle list fail", m.match_id, String(e).slice(0, 80)); }
      continue;
    }
    for (const b of list) battleJobs.push({ battle_id: b.battle_id, seq: b.seq, match: m });
  }
  console.log(league.league_id, "battles to fetch:", battleJobs.length);

  // 4) 逐局详情
  const byMatch = new Map();
  let done = 0, failed = 0;
  await pool(battleJobs, async (job) => {
    let d = null;
    try {
      const j = await getJson(BASE + "/leaguesite/battle/open?battle_id=" + encodeURIComponent(job.battle_id));
      d = j.data;
    } catch (e) {
      failed++;
      return;
    }
    if (!d || !d.battle_player_list || d.status !== 2) return;
    const picks = { 1: [], 2: [] }, bans = { 1: [], 2: [] };
    for (const p of d.battle_player_list) {
      const camp = p.camp === 1 ? 1 : 2;
      picks[camp].push({
        heroId: String(p.hero_id),
        name: p.hero_name,
        pos: POS_NAME[p.position] || "unk",
        player: p.player_name || p.actual_player_name || "",
      });
    }
    for (const b of d.bp_list || []) {
      if (Number(b.is_ban_or_pick) === 0) {
        const camp = b.camp === 1 ? 1 : 2;
        bans[camp].push(String(b.hero_id));
      }
    }
    const m = job.match;
    if (!byMatch.has(m.match_id)) {
      byMatch.set(m.match_id, {
        match_id: m.match_id,
        stage: m.match_stage_name || "",
        stage_desc: m.match_stage_desc || "",
        start_time: m.start_time,
        camp1: { team_id: m.camp1.team_id, team_name: m.camp1.team_name, score: m.camp1.score },
        camp2: { team_id: m.camp2.team_id, team_name: m.camp2.team_name, score: m.camp2.score },
        battles: [],
      });
    }
    byMatch.get(m.match_id).battles.push({
      battle_id: job.battle_id,
      seq: job.seq || d.battle_seq || 0,
      win_camp: d.win_camp,
      picks,
      bans,
    });
    done++;
    if (done % 100 === 0) console.log("  ", league.league_id, "fetched", done, "failed", failed);
  }, CONCURRENCY);

  const out = {
    league_id: league.league_id,
    league_name: league.league_name,
    year: league.year,
    start_time: league.start_time,
    end_time: league.end_time,
    fetched_at: new Date().toISOString(),
    matches: [...byMatch.values()].map((m) => ({ ...m, battles: m.battles.sort((a, b) => a.seq - b.seq) })),
  };
  fs.writeFileSync(outFile, JSON.stringify(out), "utf8");
  const nb = out.matches.reduce((a, m) => a + m.battles.length, 0);
  console.log("WROTE", path.basename(outFile), "matches", out.matches.length, "battles", nb, "failed", failed);
}

// 5) 官方英雄榜（用于交叉校验）
for (const league of leagues) {
  const f = path.join(RAW, "official-settle-" + league.league_id + ".json");
  if (!FORCE && fs.existsSync(f)) continue;
  try {
    const j = await getJson(BASE + "/leaguesite/league/hero/settle_list/open?league_id=" + league.league_id);
    fs.writeFileSync(f, JSON.stringify(j), "utf8");
    console.log("WROTE settle", league.league_id, Object.keys(j.data || {}).length);
  } catch (e) { console.log("settle fail", league.league_id, String(e).slice(0, 100)); }
}
console.log("ALL DONE");
