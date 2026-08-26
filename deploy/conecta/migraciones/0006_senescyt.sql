-- ============================================================
-- 0006 — Registro de títulos SENESCYT (espejo local / caché)
-- La consulta pública oficial exige captcha; este registro simula
-- la respuesta para el demo y sirve de caché cuando exista convenio.
-- ============================================================

create table if not exists titulos_senescyt (
  id              bigint generated always as identity primary key,
  cedula          text not null,
  titulo          text not null,
  institucion     text,
  tipo            text default 'Tercer nivel',        -- Tercer nivel | Cuarto nivel
  fecha_registro  date,
  numero_registro text,
  fuente          text not null default 'registro_local',
  created_at      timestamptz not null default now()
);

create index if not exists idx_titulos_senescyt_cedula on titulos_senescyt (cedula);

alter table titulos_senescyt enable row level security;
-- Lectura vía service role (API server-side); sin políticas públicas.

-- Semillas: títulos para las cédulas del padrón demo
insert into titulos_senescyt (cedula, titulo, institucion, tipo, fecha_registro, numero_registro) values
  ('0102030405','INGENIERA EN SOFTWARE','Universidad del Azuay','Tercer nivel','2023-08-15','1010-2023-2456789'),
  ('0203040506','INGENIERO EN CONTABILIDAD Y AUDITORÍA','Universidad de Cuenca','Tercer nivel','2022-03-10','1007-2022-2387654'),
  ('0203040506','MAGÍSTER EN TRIBUTACIÓN','Universidad de Cuenca','Cuarto nivel','2024-11-22','1007-2024-2891234'),
  ('0304050607','LICENCIADA EN ENFERMERÍA','Universidad Católica de Cuenca','Tercer nivel','2024-02-28','1103-2024-2612345'),
  ('0405060708','ABOGADO DE LOS TRIBUNALES DE JUSTICIA','Universidad del Azuay','Tercer nivel','2021-07-19','1010-2021-2298765'),
  ('0506070809','LICENCIADA EN MERCADOTECNIA','Universidad del Azuay','Tercer nivel','2023-05-30','1010-2023-2467890'),
  ('0607080910','PSICÓLOGO CLÍNICO','Universidad de Cuenca','Tercer nivel','2022-09-12','1007-2022-2412378')
on conflict do nothing;
