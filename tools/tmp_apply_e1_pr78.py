#!/usr/bin/env python3
from pathlib import Path
import base64, zlib, subprocess, sys

R = Path(__file__).resolve().parents[1]
PAYLOADS = R / 'tools' / 'e1_payloads'

def die(message):
    print('E1 APPLY ERROR:', message, file=sys.stderr)
    sys.exit(2)

def unpack(name):
    p = PAYLOADS / f'{name}.b64'
    if not p.exists():
        die(f'falta payload {p}')
    try:
        return zlib.decompress(base64.b64decode(p.read_text(encoding='utf-8').strip(), validate=True))
    except Exception as exc:
        die(f'payload {name} inválido: {exc}')

def put(path, payload):
    target = R / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)

idx = (R / 'index.html').read_text(encoding='utf-8')
if 'await window.confirmarEtapaCircuitoOC(' not in idx:
    die('index no coincide con HEAD esperado o fix ya aplicado')
if 'window.ESTADO_FINALIZADA_SALDO_REMANENTE=ESTADO_FINALIZADA_SALDO_REMANENTE;' in idx:
    die('fix ya presente')

patch_file = R / 'tools' / '.tmp_e1.patch'
patch_file.write_bytes(unpack('patch'))
subprocess.run(['git', 'apply', '--check', str(patch_file)], cwd=R, check=True)
subprocess.run(['git', 'apply', str(patch_file)], cwd=R, check=True)
patch_file.unlink()

put('supabase/migrations/202609150001_etapa1_acta_inicio_conciliacion.sql', unpack('migration'))
put('tests/etapa1_pipeline_contractual.spec.js', unpack('spec'))
put('tests/check_etapa1_hardening.js', unpack('hardening'))

check_path = R / 'tests' / 'check_etapa1_pipeline_contractual.js'
s = check_path.read_text(encoding='utf-8')
repls = [
("check(cuerpoConfirmar.indexOf('await window.confirmarEtapaCircuitoOC') >= 0,\n    'la escritura tiene que ir por el flujo canonico');",
 "check(cuerpoConfirmar.indexOf('await window.actualizarEstadoDocumentalDesdePasoContractual') >= 0,\n    'la escritura tiene que ir por el helper canonico RPC-returning');"),
("check(/const transversal = porCodigo\\.get\\(CODIGO_TRANSVERSAL\\) \\|\\| null;/.test(codigo),\n    'el evento historico de cancelacion se conserva');",
 "check(/const transversal = ultimaConfirmacion\\(historial, CODIGO_TRANSVERSAL\\) \\|\\| null;/.test(codigo),\n    'el evento historico de cancelacion conserva la confirmacion transversal mas reciente');"),
("check(/const conflicto = conflictoActa\\.get\\(estado\\.nro\\);/.test(codigo),\n    'el resumen tiene que leer el conflicto vigente');",
 "check(/const conflicto = estado\\.actaConflicto \\|\\| conflictoActa\\.get\\(estado\\.nro\\);/.test(codigo),\n    'el resumen prioriza el conflicto reconstruido desde historial y usa el Map solo como fallback de sesión');"),
("check(/const orden = reconciliarOrden\\(/.test(codigo),\n    'la confirmacion tiene que reconciliar antes de repintar');",
 "check(/const orden\\s*=\\s*reconciliarOrden\\(/.test(codigo) &&\n        /const resultId\\s*=\\s*identidadOrden\\(resultado && resultado\\.orden\\)/.test(codigo) &&\n        /contexto\\.identidad && resultId && contexto\\.identidad!==resultId/.test(codigo),\n    'la confirmacion valida UUID del servidor y reconcilia la fila confirmada antes de repintar');"),
("check(/if \\(btn\\) btn\\.disabled = true;/.test(codigo) && /if \\(btn\\) btn\\.disabled = false;/.test(codigo),\n    'el boton se bloquea durante la escritura y se restaura ante error');",
 "check(/if \\(btn\\) btn\\.disabled = true;/.test(codigo) &&\n        /finally \\{[\\s\\S]*guardando = false;[\\s\\S]*if \\(btn && btn\\.isConnected\\) btn\\.disabled = false;/.test(cuerpoConfirmar),\n    'el boton se bloquea durante la escritura y se restaura siempre desde finally');")
]
for old,new in repls:
    if old not in s:
        die('assert legacy no encontrada: '+old.splitlines()[0][:90])
    s = s.replace(old,new,1)
check_path.write_text(s, encoding='utf-8')

package_path = R / 'package.json'
s = package_path.read_text(encoding='utf-8')
old = '&& node tests/check_etapa1_pipeline_contractual.js && node tests/check_h05_um_delete_guard.js'
new = '&& node tests/check_etapa1_pipeline_contractual.js && node tests/check_etapa1_hardening.js && node tests/check_h05_um_delete_guard.js'
if old not in s:
    die('inserción package no encontrada')
package_path.write_text(s.replace(old, new, 1), encoding='utf-8')

print('E1 PR78 fix aplicado desde payloads verificados')
