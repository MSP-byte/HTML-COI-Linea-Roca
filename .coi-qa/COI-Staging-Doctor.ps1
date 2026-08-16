param(
    [ValidateSet("Doctor","UiDirty","AdminState","UiFullE2E")]
    [string]$Mode = "Doctor",
    [switch]$BootstrapUi,
    [switch]$AllowStagingWrite,
    [string]$Repo = (Get-Location).Path,
    [string]$TargetHtml = ""
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

# Safety wrapper for the RC2 QA Doctor.
# The original implementation lives in COI-Staging-Doctor-Core.ps1.
# This entrypoint MUST fail closed before any browser process can start.

$Repo = (Resolve-Path $Repo).Path
$configPath = Join-Path $Repo ".coi-qa\coi-qa.config.json"
if(-not (Test-Path $configPath)) { throw "No encuentro coi-qa.config.json." }
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$effectiveHtml = if([string]::IsNullOrWhiteSpace($TargetHtml)) { [string]$config.stagingHtml } else { $TargetHtml.Trim() }
if([System.IO.Path]::GetFileName($effectiveHtml) -ne $effectiveHtml -or -not $effectiveHtml.EndsWith('.html',[System.StringComparison]::OrdinalIgnoreCase)) {
    throw "TargetHtml debe ser un archivo HTML ubicado en la raiz del repo."
}

$stagePath = Join-Path $Repo $effectiveHtml
if(-not (Test-Path $stagePath)) { throw "No existe el HTML bajo prueba: $stagePath" }

$linkRefPath = Join-Path $Repo "supabase\.temp\project-ref"
if(-not (Test-Path $linkRefPath)) { throw "No puedo certificar el aislamiento de Supabase: falta project-ref local." }
$linkedRef = (Get-Content $linkRefPath -Raw).Trim()
if($linkedRef -ne [string]$config.stagingProjectRef) {
    if($linkedRef -eq [string]$config.productionProjectRef) {
        throw "Bloqueo de seguridad: el repo esta vinculado a PRODUCCION ($linkedRef)."
    }
    throw "Bloqueo de seguridad: ref Supabase no reconocida ($linkedRef)."
}

$stageText = Get-Content $stagePath -Raw
$refs = [regex]::Matches($stageText, 'https://([a-z0-9]+)\.supabase\.co') |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique

if($refs -contains [string]$config.productionProjectRef) {
    throw "Bloqueo de seguridad: el HTML bajo prueba contiene la referencia de PRODUCCION."
}
if(-not ($refs -contains [string]$config.stagingProjectRef)) {
    throw "Bloqueo de seguridad: el HTML bajo prueba no apunta al proyecto STAGING esperado."
}

$corePath = Join-Path $PSScriptRoot "COI-Staging-Doctor-Core.ps1"
if(-not (Test-Path $corePath)) { throw "Falta COI-Staging-Doctor-Core.ps1." }

$coreArgs = @{
    Mode = $Mode
    Repo = $Repo
    TargetHtml = $effectiveHtml
}
if($BootstrapUi) { $coreArgs.BootstrapUi = $true }
if($AllowStagingWrite) { $coreArgs.AllowStagingWrite = $true }

$previousWriteConsent = $env:COI_ALLOW_STAGING_WRITE
try {
    if($AllowStagingWrite) { $env:COI_ALLOW_STAGING_WRITE = "1" }
    else { Remove-Item Env:COI_ALLOW_STAGING_WRITE -ErrorAction SilentlyContinue }

    & $corePath @coreArgs
    exit $LASTEXITCODE
} finally {
    if($null -eq $previousWriteConsent) {
        Remove-Item Env:COI_ALLOW_STAGING_WRITE -ErrorAction SilentlyContinue
    } else {
        $env:COI_ALLOW_STAGING_WRITE = $previousWriteConsent
    }
}
