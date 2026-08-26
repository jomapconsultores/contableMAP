-- ============================================================
-- Proyecto Conecta — Esquema inicial (4 pilares)
-- Postgres 17 / Supabase
-- ============================================================

-- Extensiones
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- ENUMS
-- ------------------------------------------------------------
do $$ begin
  create type rol_usuario as enum ('graduado','empleador','autoridad','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_competencia as enum ('autodeclarada','en_curso','avalada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_curso as enum ('inscrito','en_progreso','aprobado','reprobado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_empleo as enum ('borrador','publicado','cerrado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_postulacion as enum ('borrador','enviada','en_revision','preseleccionado','rechazado','contratado');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- CATÁLOGOS
-- ------------------------------------------------------------
create table if not exists carreras (
  id          bigint generated always as identity primary key,
  nombre      text not null unique,
  facultad    text,
  nivel       text default 'Tercer nivel'
);

create table if not exists competencias (
  id          bigint generated always as identity primary key,
  nombre      text not null unique,
  descripcion text,
  area        text
);

-- Padrón oficial de graduados = fuente de verdad para autollenado
create table if not exists graduados_padron (
  cedula            text primary key,
  nombres           text not null,
  apellidos         text not null,
  carrera_id        bigint references carreras(id),
  anio_graduacion   int,
  titulo            text,
  email_institucional text,
  telefono          text,
  ciudad            text
);

-- ------------------------------------------------------------
-- IDENTIDAD / PERFILES
-- ------------------------------------------------------------
create table if not exists empresas (
  id            bigint generated always as identity primary key,
  nombre        text not null,
  ruc           text unique,
  sector        text,
  descripcion   text,
  logo_url      text,
  contacto_email text,
  validada      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  rol           rol_usuario not null default 'graduado',
  cedula        text unique,
  nombres       text,
  apellidos     text,
  carrera_id    bigint references carreras(id),
  anio_graduacion int,
  titulo        text,
  email         text,
  telefono      text,
  ciudad        text,
  linkedin      text,
  foto_url      text,
  resumen_profesional text,
  empresa_id    bigint references empresas(id),   -- para rol empleador
  origen_padron boolean not null default false,   -- true si se autollenó del padrón
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists experiencia_laboral (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references profiles(id) on delete cascade,
  empresa     text not null,
  cargo       text not null,
  ciudad      text,
  fecha_inicio date,
  fecha_fin   date,
  actual      boolean default false,
  descripcion text
);

create table if not exists educacion (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references profiles(id) on delete cascade,
  institucion text not null,
  titulo      text not null,
  nivel       text,
  fecha_inicio date,
  fecha_fin   date
);

create table if not exists habilidades (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references profiles(id) on delete cascade,
  nombre      text not null,
  nivel       int check (nivel between 1 and 5) default 3
);

-- Competencias del graduado + estado de aval
create table if not exists competencias_graduado (
  id            bigint generated always as identity primary key,
  profile_id    uuid not null references profiles(id) on delete cascade,
  competencia_id bigint not null references competencias(id) on delete cascade,
  estado        estado_competencia not null default 'autodeclarada',
  avalada_por   text,                 -- p.ej. "Universidad — Educación Continua"
  fecha_aval    timestamptz,
  curso_id      bigint,               -- curso que otorgó el aval (FK abajo)
  unique (profile_id, competencia_id)
);

-- ------------------------------------------------------------
-- EDUCACIÓN CONTINUA (cierre de brechas de competencias)
-- ------------------------------------------------------------
create table if not exists cursos (
  id            bigint generated always as identity primary key,
  nombre        text not null,
  descripcion   text,
  competencia_id bigint references competencias(id),  -- competencia que avala
  duracion_horas int,
  modalidad     text,
  precio        numeric(10,2) default 0,
  url           text
);

alter table competencias_graduado
  drop constraint if exists competencias_graduado_curso_fk;
alter table competencias_graduado
  add constraint competencias_graduado_curso_fk
  foreign key (curso_id) references cursos(id) on delete set null;

create table if not exists inscripciones_curso (
  id            bigint generated always as identity primary key,
  profile_id    uuid not null references profiles(id) on delete cascade,
  curso_id      bigint not null references cursos(id) on delete cascade,
  estado        estado_curso not null default 'inscrito',
  fecha_inscripcion timestamptz not null default now(),
  fecha_aprobacion  timestamptz,
  unique (profile_id, curso_id)
);

-- ------------------------------------------------------------
-- CV
-- ------------------------------------------------------------
create table if not exists cvs (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null unique references profiles(id) on delete cascade,
  contenido   jsonb not null default '{}'::jsonb,
  generado_ia boolean default false,
  pdf_url     text,
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- PILAR 2 — EMPLEO
-- ------------------------------------------------------------
create table if not exists empleos (
  id            bigint generated always as identity primary key,
  empresa_id    bigint not null references empresas(id) on delete cascade,
  titulo        text not null,
  descripcion   text,
  ciudad        text,
  modalidad     text,
  salario_min   numeric(10,2),
  salario_max   numeric(10,2),
  estado        estado_empleo not null default 'publicado',
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);

create table if not exists empleo_competencias (
  empleo_id      bigint not null references empleos(id) on delete cascade,
  competencia_id bigint not null references competencias(id) on delete cascade,
  requerida      boolean not null default true,
  primary key (empleo_id, competencia_id)
);

create table if not exists postulaciones (
  id            bigint generated always as identity primary key,
  empleo_id     bigint not null references empleos(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  estado        estado_postulacion not null default 'enviada',
  match_score   int,                      -- 0..100 calculado por IA
  ia_analisis   jsonb,                    -- brechas, fortalezas, recomendaciones
  created_at    timestamptz not null default now(),
  unique (empleo_id, profile_id)
);

create table if not exists retroalimentacion_empresa (
  id            bigint generated always as identity primary key,
  postulacion_id bigint references postulaciones(id) on delete cascade,
  calificacion  int check (calificacion between 1 and 5),
  comentario    text,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- PILAR 3 — SERVICIOS (16) Y MONITOREO
-- ------------------------------------------------------------
create table if not exists servicios (
  id            bigint generated always as identity primary key,
  nombre        text not null,
  descripcion   text,
  area          text,
  responsable   text,
  horas_docentes_planificadas int default 0,
  activo        boolean not null default true
);

create table if not exists servicio_atenciones (
  id            bigint generated always as identity primary key,
  servicio_id   bigint not null references servicios(id) on delete cascade,
  fecha         date not null,
  horas_reales  numeric(6,2) not null default 0,
  num_atenciones int default 0,
  docente       text
);

create table if not exists practicas_preprofesionales (
  id            bigint generated always as identity primary key,
  profile_id    uuid references profiles(id) on delete set null,
  estudiante_nombre text,
  servicio_id   bigint not null references servicios(id) on delete cascade,
  horas_planificadas int default 0,
  horas_cumplidas    int default 0,
  tutor         text,
  estado        text default 'en_curso'
);

-- ------------------------------------------------------------
-- PILAR 4 — INDICADORES (vistas)
-- ------------------------------------------------------------
create or replace view v_servicio_ejecucion as
select
  s.id,
  s.nombre,
  s.area,
  s.horas_docentes_planificadas as horas_planificadas,
  coalesce(sum(a.horas_reales),0) as horas_reales,
  coalesce(sum(a.num_atenciones),0) as atenciones,
  case when s.horas_docentes_planificadas > 0
       then round(coalesce(sum(a.horas_reales),0) / s.horas_docentes_planificadas * 100, 1)
       else 0 end as porcentaje_ejecucion
from servicios s
left join servicio_atenciones a on a.servicio_id = s.id
group by s.id;

create or replace view v_indicadores_globales as
select
  (select count(*) from profiles where rol='graduado') as total_graduados,
  (select count(*) from profiles where rol='graduado' and origen_padron) as graduados_verificados,
  (select count(*) from empleos where estado='publicado') as empleos_activos,
  (select count(*) from postulaciones) as postulaciones_totales,
  (select count(*) from postulaciones where estado='contratado') as contratados,
  (select count(*) from competencias_graduado where estado='avalada') as competencias_avaladas,
  (select count(*) from servicios where activo) as servicios_activos;

-- ------------------------------------------------------------
-- TRIGGER: crear perfil al registrarse + autollenar desde padrón
-- ------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_cedula text := new.raw_user_meta_data->>'cedula';
  v_rol    rol_usuario := coalesce((new.raw_user_meta_data->>'rol')::rol_usuario, 'graduado');
  v_empresa_nombre text := new.raw_user_meta_data->>'empresa_nombre';
  v_empresa_id bigint;
  p graduados_padron%rowtype;
begin
  select * into p from graduados_padron where cedula = v_cedula;

  -- Empleador: crear/asociar empresa
  if v_rol = 'empleador' and coalesce(v_empresa_nombre,'') <> '' then
    insert into empresas (nombre, contacto_email, validada)
    values (v_empresa_nombre, new.email, false)
    returning id into v_empresa_id;
  end if;

  insert into profiles (id, rol, cedula, nombres, apellidos, carrera_id,
                        anio_graduacion, titulo, email, telefono, ciudad, origen_padron, empresa_id)
  values (
    new.id,
    v_rol,
    v_cedula,
    coalesce(p.nombres, new.raw_user_meta_data->>'nombres'),
    coalesce(p.apellidos, new.raw_user_meta_data->>'apellidos'),
    p.carrera_id,
    p.anio_graduacion,
    p.titulo,
    new.email,
    p.telefono,
    p.ciudad,
    (p.cedula is not null),
    v_empresa_id
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- updated_at helper
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_profiles_touch on profiles;
create trigger trg_profiles_touch before update on profiles
  for each row execute function touch_updated_at();
