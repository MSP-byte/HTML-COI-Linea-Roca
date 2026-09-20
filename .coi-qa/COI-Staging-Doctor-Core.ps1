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

# ============================================================
# COI LINEA ROCA - STAGING DOCTOR
# Seguridad:
# - Por defecto: SOLO LECTURA.
# - Nunca ejecuta db reset, migration repair ni db push real.
# - UiFullE2E exige -AllowStagingWrite.
# - Bloquea la ejecucion si el proyecto vinculado no es STAGING.
# - Verifica hash SHA256 de index.html antes y despues.
# ============================================================

function Write-Section([string]$Text) {
    Write-Host ""
    Write-Host ("=" * 78) -ForegroundColor DarkCyan
    Write-Host $Text -ForegroundColor Cyan
    Write-Host ("=" * 78) -ForegroundColor DarkCyan
}

$script:Results = New-Object System.Collections.ArrayList
function Add-Result {
    param(
        [string]$Name,
        [ValidateSet("PASS","FAIL","WARN","SKIP")] [string]$Status,
        [string]$Detail = ""
    )
    [void]$script:Results.Add([pscustomobject]@{
        Check  = $Name
        Status = $Status
        Detail = $Detail
    })

    $color = switch($Status) {
        "PASS" {"Green"}
        "FAIL" {"Red"}
        "WARN" {"Yellow"}
        default {"DarkGray"}
    }
    Write-Host ("[{0}] {1}" -f $Status,$Name) -ForegroundColor $color
    if($Detail) { Write-Host ("       " + $Detail) -ForegroundColor DarkGray }
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash
}

function Get-ExactSupabaseRefs([string]$Text) {
    return [regex]::Matches($Text, 'https://([a-z0-9]+)\.supabase\.co') |
        ForEach-Object { $_.Groups[1].Value } |
        Sort-Object -Unique
}

function Test-PortOpen([string]$HostName,[int]$Port) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect($HostName,$Port,$null,$null)
        $ok = $async.AsyncWaitHandle.WaitOne(750,$false)
        if($ok -and $client.Connected) {
            $client.EndConnect($async)
            $client.Close()
            return $true
        }
        $client.Close()
        return $false
    } catch { return $false }
}

function Start-LocalServerIfNeeded {
    param([string]$RepoPath,[string]$HostName,[int]$Port)

    if(Test-PortOpen $HostName $Port) {
        Add-Result "Servidor HTTP local" "PASS" "$HostName`:$Port ya esta activo."
        return $null
    }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if(-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }
    if(-not $python) {
        Add-Result "Servidor HTTP local" "FAIL" "No encontre python/py para levantar el servidor."
        return $null
    }

    $exe = $python.Source
    $args = if($python.Name -eq "py.exe") {
        "-m http.server $Port --bind $HostName"
    } else {
        "-m http.server $Port --bind $HostName"
    }

    $p = Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory $RepoPath -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 1

    if(Test-PortOpen $HostName $Port) {
        Add-Result "Servidor HTTP local" "PASS" "Levantado automaticamente. PID=$($p.Id)"
        return $p
    }

    Add-Result "Servidor HTTP local" "FAIL" "No pudo iniciarse en $HostName`:$Port."
    return $null
}

# ------------------------------------------------------------
# Resolver paths
# ------------------------------------------------------------
$Repo = (Resolve-Path $Repo).Path
$configPathCandidates = @(
    (Join-Path $Repo ".coi-qa\coi-qa.config.json"),
    (Join-Path $PSScriptRoot "coi-qa.config.json")
)
$configPath = $configPathCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if(-not $configPath) { throw "No encuentro coi-qa.config.json." }
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$effectiveHtml = if([string]::IsNullOrWhiteSpace($TargetHtml)) { [string]$config.stagingHtml } else { $TargetHtml.Trim() }
if([System.IO.Path]::GetFileName($effectiveHtml) -ne $effectiveHtml -or -not $effectiveHtml.EndsWith('.html',[System.StringComparison]::OrdinalIgnoreCase)) {
    throw "TargetHtml debe ser un archivo HTML ubicado en la raiz del repo."
}

$logDir = Join-Path $Repo ".coi-qa\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$transcript = Join-Path $logDir "coi-doctor-$stamp.log"
Start-Transcript -Path $transcript -Force | Out-Null

try {
    Write-Section "COI LINEA ROCA - STAGING DOCTOR | modo: $Mode"
    Write-Host "Repo: $Repo"
    Write-Host "Config: $configPath"
    Write-Host "HTML bajo prueba: $effectiveHtml"
    Write-Host "Log: $transcript"

    $prodPath  = Join-Path $Repo $config.productionHtml
    $stagePath = Join-Path $Repo $effectiveHtml
    $gitPath   = Join-Path $Repo ".git"
    $linkRefPath = Join-Path $Repo "supabase\.temp\project-ref"

    # 1) Integridad local
    Write-Section "1. INTEGRIDAD DEL REPOSITORIO"
    if(Test-Path $gitPath) { Add-Result "Repositorio Git" "PASS" ".git encontrado." }
    else { Add-Result "Repositorio Git" "FAIL" ".git no encontrado." }

    if(Test-Path $prodPath) { Add-Result "index.html produccion" "PASS" $prodPath }
    else { Add-Result "index.html produccion" "FAIL" "No existe." }

    if(Test-Path $stagePath) { Add-Result "HTML bajo prueba ($effectiveHtml)" "PASS" $stagePath }
    else { Add-Result "HTML bajo prueba ($effectiveHtml)" "FAIL" "No existe." }

    if(-not (Test-Path $prodPath) -or -not (Test-Path $stagePath)) {
        throw "Faltan artefactos HTML obligatorios."
    }

    $prodHashBefore = Get-Sha256 $prodPath
    Write-Host "SHA256 index.html inicial: $prodHashBefore"

    $branch = (& git -C $Repo branch --show-current 2>&1 | Out-String).Trim()
    if($branch -eq $config.repoExpectedBranch) {
        Add-Result "Rama Git esperada" "PASS" $branch
    } else {
        Add-Result "Rama Git esperada" "WARN" "Actual=$branch | Esperada=$($config.repoExpectedBranch)"
    }

    $gitStatus = (& git -C $Repo status --short 2>&1 | Out-String).Trim()
    if([string]::IsNullOrWhiteSpace($gitStatus)) {
        Add-Result "Working tree" "PASS" "Limpio."
    } else {
        Add-Result "Working tree" "WARN" "Hay cambios locales. Se registran en el log; el Doctor no los modifica."
        Write-Host $gitStatus
    }

    # 2) Aislamiento STAGING
    Write-Section "2. AISLAMIENTO STAGING / PRODUCCION"
    if(Test-Path $linkRefPath) {
        $linkedRef = (Get-Content $linkRefPath -Raw).Trim()
        if($linkedRef -eq $config.stagingProjectRef) {
            Add-Result "Supabase project-ref vinculado" "PASS" $linkedRef
        } elseif($linkedRef -eq $config.productionProjectRef) {
            Add-Result "Supabase project-ref vinculado" "FAIL" "PELIGRO: el repo esta vinculado a PRODUCCION ($linkedRef)."
            throw "Bloqueo de seguridad: proyecto vinculado a produccion."
        } else {
            Add-Result "Supabase project-ref vinculado" "FAIL" "Ref desconocido: $linkedRef"
            throw "Bloqueo de seguridad: ref Supabase no reconocida."
        }
    } else {
        Add-Result "Supabase project-ref vinculado" "FAIL" "No existe $linkRefPath"
        throw "No puedo certificar el aislamiento de Supabase."
    }

    $stageText = Get-Content $stagePath -Raw
    $prodText  = Get-Content $prodPath -Raw

    $stageRefs = @(Get-ExactSupabaseRefs $stageText)
    $prodRefs  = @(Get-ExactSupabaseRefs $prodText)

    if($stageRefs -contains $config.stagingProjectRef) {
        Add-Result "URL STAGING en HTML" "PASS" $config.stagingProjectRef
    } else {
        Add-Result "URL STAGING en HTML" "FAIL" ("Refs detectadas: " + ($stageRefs -join ","))
    }

    if($stageRefs -contains $config.productionProjectRef) {
        Add-Result "Produccion ausente de STAGING" "FAIL" "El HTML STAGING contiene ref de produccion."
    } else {
        Add-Result "Produccion ausente de STAGING" "PASS" "No se detecto ref de produccion."
    }

    # 3) Contrato frontend
    Write-Section "3. CONTRATO FRONTEND DE RENUMERACION"
    $staticChecks = @(
        @{N="Flag RPC habilitada";      P='const\s+RENUMBER_RPC_INSTALLED\s*=\s*true\s*;'},
        @{N="Funcion renumberOrder";    P='async\s+function\s+renumberOrder\s*\('},
        @{N="Boton data-coi-renumber";  P='data-coi-renumber'},
        @{N="Llamada coi_renumerar_oc"; P='coi_renumerar_oc'},
        @{N="Detector updateDirty";     P='function\s+updateDirty\s*\('},
        @{N="nro_oc protegido";         P='PROTECTED[^;]{0,300}nro_oc'}
    )

    foreach($c in $staticChecks) {
        if([regex]::IsMatch($stageText,$c.P,[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
            Add-Result $c.N "PASS"
        } else {
            Add-Result $c.N "FAIL"
        }
    }

    $dirtyDiag = [regex]::IsMatch($stageText,'__COI_DIRTY_DIAG__')
    if($dirtyDiag) {
        Add-Result "Diagnostico dirty enriquecido" "PASS" "window.__COI_DIRTY_DIAG__ disponible."
    } else {
        Add-Result "Diagnostico dirty enriquecido" "WARN" "No esta instalado; UiDirty igual puede leer el badge."
    }

    # 4) Migraciones: verificacion local y versionada, sin invocar Supabase CLI
    Write-Section "4. MIGRACIONES VERSIONADAS (SOLO LECTURA LOCAL)"
    foreach($migration in @(
        "supabase/migrations/20260813024545_renumerar_oc.sql",
        "supabase/migrations/20260813033959_fix_renumerar_oc_servicios_um.sql"
    )) {
        $migrationPath = Join-Path $Repo $migration
        if(-not (Test-Path $migrationPath)) {
            Add-Result "Migracion $migration" "FAIL" "Archivo ausente."
            continue
        }
        & git -C $Repo ls-files --error-unmatch -- $migration 2>&1 | Out-Null
        if($LASTEXITCODE -eq 0) {
            Add-Result "Migracion $migration" "PASS" (Get-Sha256 $migrationPath)
        } else {
            Add-Result "Migracion $migration" "FAIL" "Existe localmente pero no esta versionada."
        }
    }

    # 5) Servidor local
    Write-Section "5. SERVIDOR LOCAL"
    if(Test-PortOpen $config.localHost ([int]$config.localPort)) {
        Add-Result "Puerto $($config.localPort)" "PASS" "Servidor accesible."
    } else {
        Add-Result "Puerto $($config.localPort)" "WARN" "No esta levantado. En modos UI se levanta automaticamente."
    }

    # 6) Bootstrap UI opcional
    if($BootstrapUi -or $Mode -ne "Doctor") {
        Write-Section "6. QA DE NAVEGADOR"
        $node = Get-Command node -ErrorAction SilentlyContinue
        if(-not $node) {
            Add-Result "Node.js" "FAIL" "Se requiere para automatizacion UI."
            throw "Instala dependencias con npm ci antes de ejecutar modos UI."
        }
        Add-Result "Node.js" "PASS" (& node --version)

        $qaDir = Join-Path $Repo ".coi-qa"
        & node -e "import('playwright-core').then(()=>process.exit(0)).catch(()=>process.exit(1))"
        if($LASTEXITCODE -ne 0) {
            Add-Result "playwright-core" "FAIL" "Dependencia ausente. Ejecutar npm ci fuera del Doctor."
            throw "Falta playwright-core. El Doctor no instala ni modifica dependencias."
        }
        Add-Result "playwright-core" "PASS" "Resuelto desde las dependencias declaradas del repositorio."

        $serverProc = Start-LocalServerIfNeeded -RepoPath $Repo -HostName $config.localHost -Port ([int]$config.localPort)

        $uiScript = Join-Path $qaDir "ui-smoke.mjs"
        if(-not (Test-Path $uiScript)) {
            Add-Result "ui-smoke.mjs" "FAIL" "No existe $uiScript"
            throw "Falta runner UI."
        }

        if($Mode -eq "UiDirty") {
            & node $uiScript --mode dirty --repo "$Repo" --html "$effectiveHtml" --no-pause
            $uiExit = $LASTEXITCODE
            if($uiExit -eq 0) { Add-Result "UI dirty smoke test" "PASS" "Ver reporte/screenshot en .coi-qa." }
            else { Add-Result "UI dirty smoke test" "FAIL" "ExitCode=$uiExit. Ver reporte/screenshot." }
        }

        if($Mode -eq "AdminState") {
            & node $uiScript --mode admin-state --repo "$Repo" --html "$effectiveHtml" --no-pause
            $uiExit = $LASTEXITCODE
            if($uiExit -eq 0) { Add-Result "UI Admin State" "PASS" "Sesion, rol y modulo Administracion consistentes." }
            else { Add-Result "UI Admin State" "FAIL" "ExitCode=$uiExit. Ver reporte/screenshot." }
        }

        if($Mode -eq "UiFullE2E") {
            if(-not $AllowStagingWrite) {
                Add-Result "Permiso E2E escritura STAGING" "FAIL" "Falta -AllowStagingWrite."
                throw "UiFullE2E requiere -AllowStagingWrite."
            }
            Add-Result "Permiso E2E escritura STAGING" "PASS" "Autorizado explicitamente."
            & node $uiScript --mode full --repo "$Repo" --html "$effectiveHtml" --no-pause
            $uiExit = $LASTEXITCODE
            if($uiExit -eq 0) { Add-Result "UI Full E2E renumeracion/edicion/Admin negativo" "PASS" }
            else { Add-Result "UI Full E2E renumeracion/reversion" "FAIL" "ExitCode=$uiExit. Revisar reporte." }
        }
    }

    # 7) Hash final produccion
    Write-Section "7. CONTROL FINAL DE PRODUCCION"
    $prodHashAfter = Get-Sha256 $prodPath
    if($prodHashAfter -eq $prodHashBefore) {
        Add-Result "SHA256 index.html produccion" "PASS" "INACTO: $prodHashAfter"
    } else {
        Add-Result "SHA256 index.html produccion" "FAIL" "CAMBIO DETECTADO."
        throw "STOP CRITICO: index.html cambio durante el proceso."
    }

} catch {
    Write-Host ""
    Write-Host ("STOP: " + $_.Exception.Message) -ForegroundColor Red
    if(-not ($script:Results | Where-Object {$_.Status -eq "FAIL"})) {
        Add-Result "Excepcion general" "FAIL" $_.Exception.Message
    }
} finally {
    Write-Section "RESUMEN"
    $script:Results | Format-Table -AutoSize | Out-String | Write-Host

    $summary = [pscustomobject]@{
        timestamp = (Get-Date).ToString("o")
        mode = $Mode
        repo = $Repo
        results = $script:Results
    }
    $summaryPath = Join-Path $logDir "coi-doctor-$stamp.json"
    $summary | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $summaryPath
    Write-Host "Resumen JSON: $summaryPath"
    Write-Host "Transcript:  $transcript"

    Stop-Transcript | Out-Null
}

if($script:Results | Where-Object {$_.Status -eq "FAIL"}) { exit 2 }
exit 0
