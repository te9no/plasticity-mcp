param([string]$Executable)
$ErrorActionPreference = 'Stop'
try {
    $targets = Invoke-RestMethod 'http://127.0.0.1:9223/json/list' -TimeoutSec 2
    if (@($targets | Where-Object url -Match 'Plasticity.*app_window').Count -gt 0) { Write-Host 'Plasticity debugger is already available.'; return }
} catch {}
if (Get-Process Plasticity -ErrorAction SilentlyContinue) { throw 'Plasticity is running without the debugger. Save your documents and close Plasticity before running this launcher. No processes were stopped.' }
if (-not $Executable) { $Executable = Join-Path $env:LOCALAPPDATA 'Plasticity/app-25.3.0/Plasticity.exe' }
$resolvedExe = (Resolve-Path -LiteralPath $Executable).Path
Start-Process -FilePath $resolvedExe -ArgumentList '--remote-debugging-port=9223','--remote-debugging-address=127.0.0.1' -WindowStyle Normal
Write-Host 'Started Plasticity with a loopback debugger. Select a window explicitly in your MCP client.'
