-- ============================================================
-- 0007 — Área de conocimiento (CINE/UNESCO) en títulos y educación,
-- y soporte para títulos declarados por el usuario dentro del sistema.
-- ============================================================

alter table titulos_senescyt add column if not exists area_codigo text;
alter table titulos_senescyt add column if not exists area_nombre text;

alter table educacion add column if not exists area_codigo text;
alter table educacion add column if not exists area_nombre text;

-- Áreas para las semillas del registro espejo
update titulos_senescyt set area_codigo = '06', area_nombre = 'Tecnologías de la información y la comunicación (TIC)' where area_codigo is null and titulo = 'INGENIERA EN SOFTWARE';
update titulos_senescyt set area_codigo = '04', area_nombre = 'Administración de empresas y derecho' where area_codigo is null and titulo in ('INGENIERO EN CONTABILIDAD Y AUDITORÍA','MAGÍSTER EN TRIBUTACIÓN','ABOGADO DE LOS TRIBUNALES DE JUSTICIA','LICENCIADA EN MERCADOTECNIA');
update titulos_senescyt set area_codigo = '09', area_nombre = 'Salud y bienestar' where area_codigo is null and titulo = 'LICENCIADA EN ENFERMERÍA';
update titulos_senescyt set area_codigo = '03', area_nombre = 'Ciencias sociales, periodismo e información' where area_codigo is null and titulo = 'PSICÓLOGO CLÍNICO';
