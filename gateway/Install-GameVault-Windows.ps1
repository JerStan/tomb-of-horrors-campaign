# Windows 11 GameVault local installer. Run in PowerShell as your own account.
$ErrorActionPreference = 'Stop'
$dest = Join-Path $HOME 'GameVaultServer'
$temp = Join-Path $env:TEMP ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp -Force | Out-Null
try {
  if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw 'Python 3.11+ required. Install Python and rerun.' }
  & python -c "import sys; assert sys.version_info >= (3,11), 'Python 3.11+ required'"
  if (-not (Get-Command codex -ErrorAction SilentlyContinue)) { Write-Warning 'Install Codex CLI and sign into your ChatGPT account before playing.' }
  $zip = Join-Path $temp 'source.zip'
  Invoke-WebRequest -Uri 'https://github.com/JerStan/tomb-of-horrors-campaign/archive/refs/heads/main.zip' -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $temp -Force
  $src = Join-Path $temp 'tomb-of-horrors-campaign-main'
  if (-not (Test-Path (Join-Path $src 'gateway/server.py'))) { throw 'GameVault server source missing from archive.' }
  New-Item -ItemType Directory -Path (Join-Path $dest 'gateway') -Force | Out-Null
  Copy-Item (Join-Path $src 'gateway/server.py') (Join-Path $dest 'gateway/server.py') -Force
  Copy-Item (Join-Path $src 'gateway/play-bridge.mjs') (Join-Path $dest 'gateway/play-bridge.mjs') -Force
  Copy-Item (Join-Path $src 'gateway/Start-GameVault-Bridge.ps1') (Join-Path $dest 'Start-GameVault-Bridge.ps1') -Force
  Copy-Item (Join-Path $src 'campaign-memory.json') (Join-Path $dest 'campaign-memory.json') -Force
  $secret = Join-Path $dest 'gateway/access-token.txt'
  if (-not (Test-Path $secret)) {
    $bytes = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    [IO.File]::WriteAllText($secret,[Convert]::ToHexString($bytes))
    & icacls $secret /inheritance:r /grant:r "$($env:USERNAME):R" | Out-Null
  }
  & python -m py_compile (Join-Path $dest 'gateway/server.py')
  $runner = @'
$ErrorActionPreference = "Stop"
$dir = Join-Path $HOME "GameVaultServer"
$env:GAMEVAULT_ACCESS_TOKEN = [IO.File]::ReadAllText((Join-Path $dir "gateway/access-token.txt")).Trim()
$env:GAMEVAULT_DB = Join-Path $dir "gateway/gamevault.sqlite3"
Set-Location $dir
& python (Join-Path $dir "gateway/server.py")
'@
  Set-Content -Path (Join-Path $dest 'Start-GameVault.ps1') -Value $runner -Encoding UTF8
  Write-Host ''
  Write-Host "Installed GameVault to $dest" -ForegroundColor Green
  Write-Host 'To start: PowerShell -ExecutionPolicy Bypass -File $HOME/GameVaultServer/Start-GameVault.ps1'
  Write-Host 'Server is local-only. Secure external HTTPS gateway and Codex authentication are still required.'
  Write-Host 'Never share gateway/access-token.txt.'
} finally {
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
