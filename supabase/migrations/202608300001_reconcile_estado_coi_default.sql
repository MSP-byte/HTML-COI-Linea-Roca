-- =====================================================================
-- H02.1 — Reconciliacion del default de public.coi_ordenes.estado_coi
-- =====================================================================
--
-- MOTIVO
--   Verificacion en lectura sobre los dos entornos:
--     produccion (ooepgbzqlpjrtpaoqawc) -> default 'En ejecución'   correcto
--     staging    (brmrroikctfbtzwfewan) -> default 'En ejecuciÃ³n'   mojibake
--
--   El valor de staging es la secuencia UTF-8 de 'ó' (C3 B3) reinterpretada
--   como Latin-1, sintoma clasico de un DDL aplicado con la codificacion de
--   cliente equivocada. Las demas firmas estructurales entre ambos entornos
--   coinciden, de modo que este es el unico desvio a corregir.
--
--   Efecto practico: en staging toda OC insertada sin estado_coi explicito
--   nace con un estado que ningun filtro ni comparacion del sistema reconoce.
--
-- ALCANCE
--   Solo el default de esa columna. No se modifica el tipo, ni la nullability,
--   ni ninguna otra columna, tabla, policy, RPC o grant.
--
-- COMPORTAMIENTO POR ENTORNO
--   produccion : el default ya es este valor, de modo que es un NO-OP.
--   staging    : corrige el default mojibake.
--   base nueva : refuerza el valor que ya trae el baseline
--                202608090000_core_schema_baseline.sql.
--
--   «alter column ... set default» reescribe unicamente el catalogo: no toca
--   ninguna fila existente ni reevalua los valores ya almacenados. Las OC que
--   hoy tengan el estado mojibake en staging conservan su valor; corregir esos
--   datos es una decision operativa aparte y deliberadamente fuera de aqui.
--
--   Es idempotente: reaplicarla deja exactamente el mismo default.
--
-- NO SE MODIFICA 202608090000_core_schema_baseline.sql: H02 ya esta cerrado y
-- mergeado, y las migraciones aplicadas no se reescriben hacia atras.

alter table public.coi_ordenes
  alter column estado_coi
  set default 'En ejecución';
