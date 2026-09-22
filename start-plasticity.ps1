param([string]$Executable, [switch]$Experimental26, [switch]$Hidden)
$ErrorActionPreference = 'Stop'
$debugPort = if ($Experimental26) { 9230 } else { 9223 }
$targets = $null
try {
    $targets = Invoke-RestMethod "http://127.0.0.1:$debugPort/json/list" -TimeoutSec 2 -NoProxy
} catch {}
if ($null -ne $targets) {
    $matching = @($targets | Where-Object url -Match 'Plasticity.*app_window')
    if ($Experimental26) {
        # Electron inspectors have a generic title; verify the listener's process.
        $listeners = @(Get-NetTCPConnection -LocalPort $debugPort -State Listen -ErrorAction SilentlyContinue)
        $owners = @($listeners | ForEach-Object { Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue })
        $matching = @($targets | Where-Object { $_.type -eq 'node' -and $owners.Count -gt 0 -and @($owners | Where-Object ProcessName -NE 'Plasticity').Count -eq 0 })
    }
    if ($matching.Count -gt 0) { Write-Host "Plasticity's debugger is already available at port $debugPort. Run MCP doctor to select and verify its windows."; return }
    throw "Port $debugPort is occupied by an unverified debugger. No application was launched. Inspect the existing listener before retrying."
}
if (Get-Process Plasticity -ErrorAction SilentlyContinue) { throw 'Plasticity is running without the debugger. Save your documents and close Plasticity before running this launcher. No processes were stopped.' }
if (-not $Executable) {
    $appVersion = if ($Experimental26) { '26.1.3' } else { '25.3.0' }
    $Executable = @((Join-Path $env:LOCALAPPDATA "Plasticity/app-$appVersion/Plasticity.exe"), (Join-Path $env:ProgramFiles "Plasticity/app-$appVersion/Plasticity.exe")) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $Executable) { throw "Plasticity $appVersion was not found. Pass -Executable with its full path." }
}
$resolvedExe = (Resolve-Path -LiteralPath $Executable).Path
$launchArguments = if ($Experimental26) { @('--inspect=127.0.0.1:9230') } else { @('--remote-debugging-port=9223','--remote-debugging-address=127.0.0.1') }
$windowStyle = if ($Hidden) { 'Hidden' } else { 'Normal' }
Start-Process -FilePath $resolvedExe -WorkingDirectory (Split-Path -Parent $resolvedExe) -ArgumentList $launchArguments -WindowStyle $windowStyle
Write-Host 'Started Plasticity with a loopback debugger. Select a window explicitly in your MCP client.'
