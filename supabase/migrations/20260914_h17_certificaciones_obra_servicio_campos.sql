-- H17: campos adicionales para Carga Operativa > Carga Certificación.
-- Mantiene las columnas generadas existentes para acumulado y AUX %.
alter table public.coi_certificaciones
  add column if not exists id_obra text,
  add column if not exists proveedor text,
  add column if not exists nro_hes text,
  add column if not exists nro_if text;
