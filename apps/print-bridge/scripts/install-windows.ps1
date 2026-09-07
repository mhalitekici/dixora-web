param(
    [Parameter(Mandatory = $true)][string]$ApiUrl,
    [Parameter(Mandatory = $true)][string]$EnrollmentCode,
    [string]$Name = $env:COMPUTERNAME,
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "DixoraPrintBridge")
)

$ErrorActionPreference = "Stop"
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$node = Get-Command node -ErrorAction Stop
$nodePath = $node.Source

if ([System.Version]((& $nodePath --version).TrimStart("v")) -lt [System.Version]"22.0") {
    throw "Dixora Print Bridge requires Node.js 22 or newer."
}

if (-not [string]::Equals($sourceRoot.TrimEnd("\\"), $InstallRoot.TrimEnd("\\"), [System.StringComparison]::OrdinalIgnoreCase)) {
    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
    Get-ChildItem -Force -LiteralPath $sourceRoot |
        Where-Object { $_.Name -ne "state" } |
        Copy-Item -Destination $InstallRoot -Recurse -Force
}

$stateDirectory = Join-Path $InstallRoot "state"
New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
$env:PRINT_BRIDGE_API_URL = $ApiUrl.TrimEnd("/")
$env:NODE_ENV = "production"
$env:PRINT_BRIDGE_TRANSPORT = "auto"
$env:PRINT_BRIDGE_PORT = "0"
$env:PRINT_BRIDGE_CREDENTIALS_PATH = Join-Path $stateDirectory "credentials.json"
$env:PRINT_BRIDGE_JOURNAL_PATH = Join-Path $stateDirectory "journal.json"

& $nodePath (Join-Path $InstallRoot "dist\index.js") enroll --code $EnrollmentCode --name $Name

$runScript = Join-Path $InstallRoot "scripts\run-windows.ps1"
$quotedRunScript = $runScript.Replace('"', '""')
$quotedApiUrl = $env:PRINT_BRIDGE_API_URL.Replace('"', '""')
$quotedNodePath = $nodePath.Replace('"', '""')
$quotedInstallRoot = $InstallRoot.Replace('"', '""')
$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$quotedRunScript`" -ApiUrl `"$quotedApiUrl`" -NodePath `"$quotedNodePath`" -InstallRoot `"$quotedInstallRoot`""

& schtasks.exe /Create /TN "Dixora Print Bridge" /TR $taskCommand /SC ONLOGON /RL LIMITED /F | Out-Null
& schtasks.exe /Run /TN "Dixora Print Bridge" | Out-Null

Write-Output "Dixora Print Bridge installed for $Name. It starts at sign-in and is running now."
