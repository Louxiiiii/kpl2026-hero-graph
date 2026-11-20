# 一键开公网链接：本地静态服务 + Cloudflare 快速隧道（无需账号）
# 用法：powershell -ExecutionPolicy Bypass -File publish.ps1
# 关闭此窗口 = 链接失效；电脑休眠/关机同样失效。
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 8788
$cf = Join-Path $env:TEMP "cloudflared.exe"

if (-not (Test-Path $cf)) {
  Write-Host "首次使用，下载 cloudflared ..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cf -UseBasicParsing
}

$alive = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $alive) {
  Write-Host "启动本地服务 http://127.0.0.1:$Port/ ..."
  Start-Process -FilePath "node" -ArgumentList "serve.mjs" -WorkingDirectory $Root -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

Write-Host "建立公网隧道（几秒后给出 https://xxx.trycloudflare.com 地址）..."
& $cf tunnel --url "http://127.0.0.1:$Port" --no-autoupdate
