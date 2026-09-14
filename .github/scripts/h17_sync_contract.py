from pathlib import Path
import json

path = Path('tests/fixtures/production_schema_contract.json')
data = json.loads(path.read_text(encoding='utf-8'))

columns = data['coi_certificaciones']['columnas']
for name in ('id_obra', 'proveedor', 'nro_hes', 'nro_if'):
    columns[name] = {'nn': False, 'tipo': 'text'}

# Registrar H17 como divergencia ya resuelta porque la migración fue aplicada en producción.
resolved = data.setdefault('_divergencias_pendientes', {}).setdefault('_resueltas', [])
if not any(item.get('migracion') == '20260914150000_certificaciones_obra_servicio_fields.sql' for item in resolved):
    resolved.append({
        'tabla': 'coi_certificaciones',
        'columnas': ['id_obra', 'proveedor', 'nro_hes', 'nro_if'],
        'produccion': 'presente',
        'repo': 'presente',
        'migracion': '20260914150000_certificaciones_obra_servicio_fields.sql',
        'aplicada_en_remoto': '2026-09-14',
        'nota': 'H17 aplicado en PRODUCCION. El snapshot productivo incluye los cuatro campos de Carga Certificación diferenciada para Obra y Servicio.'
    })

if isinstance(data.get('_doc'), str):
    data['_doc'] = 'Snapshot de information_schema y pg_catalog de PRODUCCION, reconciliado con STAGING. Actualizado 2026-09-14 tras H17 Carga Certificación diferenciada para Obra y Servicio. nn=NOT NULL, def=fragmento esperado del default, gen=generated always stored, tipo=fragmento de data_type. fk=[columna, tabla_destino, accion ON DELETE].'

path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('H17 production schema contract synchronized')
