-- La IA extrae una fecha del propio documento (fecha de emisión, de curso,
-- de contrato, etc.) para poder ordenar cada carpeta del repositorio
-- cronológicamente, en vez de solo por fecha de subida.
alter table documentos_personales add column if not exists fecha_documento date;

create index if not exists idx_documentos_personales_categoria_fecha
  on documentos_personales(profile_id, categoria, fecha_documento desc nulls last);
