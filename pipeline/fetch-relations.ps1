# 抓取官网英雄资料页（GB18030）里的「英雄关系」，供 parse-relations.mjs 解析
# 关键：新英雄的详情页用拼音 slug（herodetail/wangwei.shtml），不是数字 id，
#       slug 在 herolist.json 的 id_name 字段里，所以这里按 slug 抓、按数字 id 存。
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Out  = Join-Path $Root "pipeline\raw\relations"
$Raw  = Join-Path $Root "pipeline\raw"
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$wc = New-Object System.Net.WebClient
$wc.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")

$listBytes = $wc.DownloadData("https://pvp.qq.com/web201605/js/herolist.json")
[System.IO.File]::WriteAllBytes((Join-Path $Raw "herolist.json"), $listBytes)
$list = [System.Text.Encoding]::UTF8.GetString($listBytes) | ConvertFrom-Json

$ok = 0; $cached = 0; $fail = @()
foreach ($h in $list) {
  $id = [string]$h.ename
  $slug = [string]$h.id_name
  if (-not $slug) { continue }
  $file = Join-Path $Out ($id + ".html")
  if (Test-Path $file) { $cached++; continue }
  try {
    $bytes = $wc.DownloadData("https://pvp.qq.com/web201605/herodetail/$slug.shtml")
    [System.IO.File]::WriteAllBytes($file, $bytes)
    $ok++
  } catch { $fail += ($id + ":" + $slug) }
  Start-Sleep -Milliseconds 100
}
"heroes=$($list.Count) downloaded=$ok cached=$cached fail=$($fail.Count)"
if ($fail.Count) { "failed: " + ($fail -join ",") }
