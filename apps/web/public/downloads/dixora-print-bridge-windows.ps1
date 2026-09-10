param(
    [Parameter(Mandatory = $true)][string]$ApiUrl,
    [Parameter(Mandatory = $true)][string]$EnrollmentCode,
    [string]$Name = $env:COMPUTERNAME,
    [string]$BundlePath = (Split-Path -Parent $PSCommandPath)
)

$installer = Join-Path $BundlePath "scripts\install-windows.ps1"
if (-not (Test-Path -LiteralPath $installer)) {
    throw "Taşınabilir Print Bridge paketi bulunamadı. Bu betiği release/dixora-print-bridge klasörü içinden çalıştırın."
}

& $installer -ApiUrl $ApiUrl -EnrollmentCode $EnrollmentCode -Name $Name
