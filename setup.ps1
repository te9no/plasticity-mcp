param([switch]$WithIges)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
$nodeVersion = & $nodePath -p 'process.versions.node'
if ([int]($nodeVersion.Split('.')[0]) -lt 22) { throw 'Node.js 22 or newer is required.' }
Push-Location (Join-Path $projectRoot 'mcp-server')
try {
    & npm.cmd ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
} finally { Pop-Location }
if ($WithIges) {
    $cadPython = Join-Path $projectRoot '.venv/Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $cadPython)) {
        & python -m venv (Join-Path $projectRoot '.venv')
        if ($LASTEXITCODE -ne 0) { throw 'CAD Python environment creation failed.' }
    }
    & $cadPython -m pip install --only-binary=:all: -r (Join-Path $projectRoot 'mcp-server/scripts/requirements-cad.txt')
    if ($LASTEXITCODE -ne 0) { throw 'IGES dependency installation failed.' }
}
$config = @{mcpServers=@{plasticity=@{command=$nodePath;args=@((Join-Path $projectRoot 'mcp-server/dist/index.js'));env=@{PLASTICITY_CDP_URL='http://127.0.0.1:9223'}}}}
$config | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $projectRoot 'mcp-client.json')
Write-Host 'Build and tests passed. MCP client configuration: mcp-client.json'
Write-Host 'For the running app connection check: cd mcp-server; npm run doctor'
