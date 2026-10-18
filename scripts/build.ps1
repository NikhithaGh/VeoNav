$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $localNode = Join-Path $env:LOCALAPPDATA 'AeroNavTools\node-v22.16.0-win-x64'
    if (-not (Test-Path (Join-Path $localNode 'node.exe'))) { throw 'Install Node.js 22 or newer before building.' }
    $env:PATH = "$localNode;$env:PATH"
}
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
