#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const path = 'supabase/migrations/202609070001_h10_order_lifecycle_guard.sql';
const sql = fs.readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');

const check = (condition, message) => assert.ok(condition, message);

check(/create\s+trigger\s+coi_ordenes_h10_insert_guard[\s\S]*?before\s+insert\s+on\s+public\.coi_ordenes/i.test(sql),
  'H10 debe instalar un BEFORE INSERT sobre coi_ordenes');
check(/if\s+tg_op\s*=\s*'INSERT'\s+then/i.test(sql),
  'el guard H10 debe distinguir INSERT antes de leer OLD');

const insertStart = sql.search(/if\s+tg_op\s*=\s*'INSERT'\s+then/i);
const insertEnd = sql.indexOf('return new;', insertStart);
check(insertStart >= 0 && insertEnd > insertStart,
  'no se pudo aislar la rama INSERT del guard H10');
const insertBranch = sql.slice(insertStart, insertEnd + 'return new;'.length);

check(/v_new_registro\s+in\s*\(\s*'ARCHIVADO'\s*,\s*'ARCHIVADA'\s*\)/i.test(insertBranch) &&
      /COI_ARCHIVE_REQUIRES_CLOSED_ORDER/.test(insertBranch),
  'una OC no puede nacer Archivada: archivar es una transición posterior');
check(/v_new_registro\s*=\s*'CERRADO'/i.test(insertBranch) &&
      /COI_CLOSE_REQUIRES_ATOMIC_AUDIT/.test(insertBranch),
  'un alta no puede crear un cierre nuevo mediante estado_registro=Cerrado');
check(/v_new_estado_cerrado[\s\S]*?new\.fecha_cierre_operativo\s+is\s+not\s+null[\s\S]*?v_new_observacion\s+is\s+not\s+null/i.test(insertBranch),
  'si el INSERT trae cualquier señal de cierre debe validar el conjunto de auditoría');
check(/not\s+v_new_estado_cerrado[\s\S]*?new\.fecha_cierre_operativo\s+is\s+null[\s\S]*?v_new_observacion\s+is\s+null/i.test(insertBranch) &&
      /COI_CLOSE_REQUIRES_ATOMIC_AUDIT/.test(insertBranch),
  'el cierre creado por INSERT debe exigir estado Cerrada + fecha + observación en una sola escritura');

check(/before\s+update\s+of\s+fecha_cierre_operativo,\s*observacion_cierre/i.test(sql),
  'el nuevo guard de INSERT no puede reemplazar la inmutabilidad del audit guard de UPDATE');
check(/before\s+update\s+of\s+estado_coi,\s*estado_registro/i.test(sql),
  'el nuevo guard de INSERT no puede reemplazar el state guard de UPDATE');
check(!/create\s+table|alter\s+table[^;]*add\s+column/i.test(sql),
  'el fix H10 de INSERT no debe agregar tablas ni columnas');

console.log('H10 INSERT lifecycle guard: OK');

check(/COI_ARCHIVE_STATE_FIELD_FORBIDDEN/.test(sql) && /ARCHIVADA.*ARCHIVADO/s.test(sql),
  'estado_coi no puede recibir nuevas escrituras Archivada/Archivado');
check(/COI_LEGACY_CLOSE_REQUIRES_CANONICALIZATION/.test(sql),
  'el archivo server-side debe impedir destruir un cierre legacy-only');
check(/v_old_registro\s*=\s*'CERRADO'[\s\S]*?v_new_registro\s+in\s*\(\s*'ARCHIVADO'\s*,\s*'ARCHIVADA'\s*\)[\s\S]*?not\s+v_new_estado_cerrado/i.test(sql),
  'el guard legacy debe exigir canonicalización del estado operativo antes de archivar');

console.log('H10 lifecycle final review: OK');
