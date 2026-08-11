-- =====================================================================
-- ContableMAP · 0010 · Deduplicación de documentos
-- Huella del contenido del archivo para detectar, antes de procesarlo, que un
-- documento (el mismo estado de cuenta, la misma factura) ya se subió, y
-- evitar así reprocesar y volver a pagar la extracción con IA.
-- =====================================================================

alter table public.documentos
  add column if not exists contenido_hash text;

-- Búsqueda del duplicado por entidad + huella.
create index if not exists idx_documentos_hash
  on public.documentos(entidad_id, contenido_hash);
