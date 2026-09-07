param(
    [Parameter(Mandatory = $true)][string]$ApiUrl,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$InstallRoot
)

$ErrorActionPreference = "Stop"
$stateDirectory = Join-Path $InstallRoot "state"
New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null

$env:PRINT_BRIDGE_API_URL = $ApiUrl.TrimEnd("/")
$env:NODE_ENV = "production"
$env:PRINT_BRIDGE_TRANSPORT = "auto"
$env:PRINT_BRIDGE_PORT = "0"
$env:PRINT_BRIDGE_CREDENTIALS_PATH = Join-Path $stateDirectory "credentials.json"
$env:PRINT_BRIDGE_JOURNAL_PATH = Join-Path $stateDirectory "journal.json"

while ($true) {
    & $NodePath (Join-Path $InstallRoot "dist\index.js") run
    if ($LASTEXITCODE -eq 0) {
        break
    }
    Start-Sleep -Seconds 10
}
