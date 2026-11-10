param(
  [Parameter(Mandatory)]
  [string] $Configuration
)

$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$config = (Resolve-Path -LiteralPath $Configuration).Path
& $node (Join-Path $PSScriptRoot 'gateway/play-bridge.mjs') $config
exit $LASTEXITCODE
