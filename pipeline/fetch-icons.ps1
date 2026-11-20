# 下载缺失的英雄头像（官方 CDN），随后归一化扩展名
$Root = Split-Path -Parent $PSScriptRoot
$HeroDir = Join-Path $Root "assets\hero"
New-Item -ItemType Directory -Force -Path $HeroDir | Out-Null
$ids = Get-Content (Join-Path $Root "pipeline\hero-ids.json") -Raw | ConvertFrom-Json
$have = @{}
Get-ChildItem $HeroDir -File | ForEach-Object { $have[$_.BaseName] = $true }
$missing = @($ids | Where-Object { -not $have[$_] })
"missing: $($missing -join ',')"
foreach ($id in $missing) {
  $out = Join-Path $HeroDir ($id + ".jpg")
  $ok = $false
  foreach ($u in @("https://res.edata.qq.com/sgame/static/images/hero/$id.jpg", "https://game.gtimg.cn/images/yxzj/img201606/heroimg/$id/$id.jpg")) {
    try {
      Invoke-WebRequest -Uri $u -OutFile $out -UseBasicParsing -TimeoutSec 25
      if ((Get-Item $out).Length -gt 2000) { $ok = $true; break }
    } catch {}
  }
  if (-not $ok) { if (Test-Path $out) { Remove-Item $out -Force }; "FAIL $id" } else { "OK $id" }
}
Push-Location $Root
node pipeline/normalize-icons.mjs
Pop-Location
