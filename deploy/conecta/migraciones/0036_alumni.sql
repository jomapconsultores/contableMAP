-- ============================================================
-- 0036 — Módulo Alumni: registro depurado de graduados (importación del
-- reporte institucional + autoservicio de los propios graduados).
--
-- Modelo: `alumni` es 1 fila por persona (cédula única) y `alumni_titulos`
-- 1 fila por título (el Excel institucional trae una fila por título, con
-- 3.529 personas y ~5.100 títulos). No se extiende graduados_padron porque
-- ese registro es 1-persona-1-título y alimenta handle_new_user(); aquí se
-- necesita el historial completo de títulos más datos de contacto/ocupación.
--
-- La fuente y el estado de verificación permiten que un re-import del
-- reporte institucional NO pise datos que el propio graduado actualizó
-- (autoservicio), y que lo enviado por el canal público pase por revisión
-- de un administrador antes de aplicarse (tabla alumni_actualizaciones).
-- ============================================================

-- ------------------------------------------------------------
-- Persona (1 fila por cédula)
-- ------------------------------------------------------------
create table if not exists alumni (
  id                    bigint generated always as identity primary key,
  cedula                text not null unique,
  nombres               text not null,
  apellidos             text not null,
  genero                text check (genero in ('masculino','femenino','otro')),
  email                 text,
  celular               text,
  -- Los teléfonos de 7 dígitos del reporte son convencionales, no celulares:
  -- se separan para no contaminar campañas por WhatsApp/SMS.
  telefono_fijo         text,
  ciudad                text,
  ocupacion             text,
  cargo                 text,
  empresa               text,
  -- Categoría derivada de la ocupación libre, para poder agregar en reportes.
  ocupacion_categoria   text not null default 'sin_datos'
    check (ocupacion_categoria in
      ('empleado','independiente','docente','estudiante','desempleado','otro','sin_datos')),
  -- Enlace a la cuenta del sistema cuando el graduado se registra (por cédula).
  profile_id            uuid references profiles(id) on delete set null,
  fuente                text not null default 'importacion_excel'
    check (fuente in ('importacion_excel','autoservicio','cuenta')),
  estado_verificacion   text not null default 'importado'
    check (estado_verificacion in ('importado','pendiente_revision','verificado')),
  -- Última vez que el PROPIO graduado actualizó sus datos (no el import).
  datos_actualizados_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_alumni_profile on alumni(profile_id);
create index if not exists idx_alumni_ocupacion_cat on alumni(ocupacion_categoria);

drop trigger if exists trg_alumni_touch on alumni;
create trigger trg_alumni_touch before update on alumni
  for each row execute function touch_updated_at();

-- ------------------------------------------------------------
-- Títulos (1 fila por título)
-- ------------------------------------------------------------
create table if not exists alumni_titulos (
  id                    bigint generated always as identity primary key,
  alumni_id             bigint not null references alumni(id) on delete cascade,
  titulo                text not null,
  -- Sin tilde a propósito: el import normaliza MAESTRÍA -> MAESTRIA.
  nivel_formacion       text check (nivel_formacion in ('PROFESIONAL','ESPECIALISTA','MAESTRIA')),
  instituto             text,
  anio_graduacion       int check (anio_graduacion between 1950 and 2035),
  -- Se llena vía titulos_mapeo (el reporte trae facultad/carrera vacías en
  -- ~97% de las filas).
  carrera_id            bigint references carreras(id),
  fuente                text not null default 'importacion_excel'
    check (fuente in ('importacion_excel','autoservicio','cuenta')),
  -- Columna "Fecha creación" del reporte institucional.
  fecha_creacion_origen date,
  created_at            timestamptz not null default now(),
  -- Clave de idempotencia del re-import: la misma persona puede tener el
  -- mismo título en años distintos, pero no dos veces el mismo año.
  unique (alumni_id, titulo, anio_graduacion)
);

create index if not exists idx_alumni_titulos_alumni on alumni_titulos(alumni_id);
create index if not exists idx_alumni_titulos_carrera on alumni_titulos(carrera_id);

-- ------------------------------------------------------------
-- Mapeo título -> carrera -> facultad (propuesto por IA, revisable por el
-- administrador; los reportes por facultad/carrera dependen de esto).
-- ------------------------------------------------------------
create table if not exists titulos_mapeo (
  id                 bigint generated always as identity primary key,
  -- upper + espacios colapsados (misma normalización que usa el import).
  titulo_normalizado text not null unique,
  carrera_nombre     text,
  facultad           text,
  carrera_id         bigint references carreras(id),
  origen             text not null default 'ia' check (origen in ('ia','manual','excel')),
  confianza          numeric(3,2) check (confianza between 0 and 1),
  revisado           boolean not null default false,
  revisado_por       uuid references profiles(id),
  created_at         timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Staging del autoservicio público: lo enviado sin sesión queda pendiente
-- hasta que un administrador lo apruebe (defensa frente a suplantación con
-- cédula+año adivinados). payload: {datos:{...}, titulos:[...],
-- origen_campos:{campo:'voz'|'documento'|'manual'}}.
-- ------------------------------------------------------------
create table if not exists alumni_actualizaciones (
  id           bigint generated always as identity primary key,
  alumni_id    bigint references alumni(id) on delete cascade,
  cedula       text not null,
  payload      jsonb not null,
  fuente       text not null check (fuente in ('publico','cuenta')),
  estado       text not null default 'pendiente'
    check (estado in ('pendiente','aprobada','rechazada')),
  revisada_por uuid references profiles(id),
  revisada_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_alumni_act_estado on alumni_actualizaciones(estado);
create index if not exists idx_alumni_act_alumni on alumni_actualizaciones(alumni_id);

-- ------------------------------------------------------------
-- Módulo 'alumni' en el sistema de permisos (0032).
-- El CHECK original de permisos_modulo.modulo es inline: su nombre
-- autogenerado es permisos_modulo_modulo_check.
-- ------------------------------------------------------------
alter table permisos_modulo drop constraint if exists permisos_modulo_modulo_check;
alter table permisos_modulo add constraint permisos_modulo_modulo_check check (modulo in (
  'personas', 'empleabilidad', 'servicios', 'practicas',
  'cursos', 'indicadores', 'encuestas', 'psicometria', 'alumni'
));

-- La siembra de módulos para autoridades nuevas debe incluir 'alumni'.
create or replace function sembrar_permisos_modulo_autoridad()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rol = 'autoridad' and new.aprobado = true and (old.aprobado is distinct from true)
     and not exists (select 1 from permisos_modulo where profile_id = new.id) then
    insert into permisos_modulo (profile_id, modulo)
    select new.id, m.modulo
    from unnest(array['personas','empleabilidad','servicios','practicas','cursos','indicadores','encuestas','psicometria','alumni']) as m(modulo)
    on conflict (profile_id, modulo) do nothing;
  end if;
  return new;
end $$;

-- Autoridades ya aprobadas parten con el módulo nuevo (mismo criterio que la
-- siembra original de 0032: preservar el acceso por defecto; el admin puede
-- revocarlo desde /admin/autoridades).
insert into permisos_modulo (profile_id, modulo)
select id, 'alumni' from profiles
where rol = 'autoridad' and aprobado = true
on conflict (profile_id, modulo) do nothing;

-- ------------------------------------------------------------
-- RLS. Sin políticas para anon: las rutas públicas de autoservicio usan la
-- clave de servicio con validaciones y rate limit propios.
-- ------------------------------------------------------------
alter table alumni enable row level security;
alter table alumni_titulos enable row level security;
alter table titulos_mapeo enable row level security;
alter table alumni_actualizaciones enable row level security;

drop policy if exists alumni_staff_all on alumni;
create policy alumni_staff_all on alumni for all
  using ((select is_staff()) and has_modulo('alumni'))
  with check ((select is_staff()) and has_modulo('alumni'));

-- El propio graduado (cuenta enlazada) puede ver su ficha.
drop policy if exists alumni_owner_read on alumni;
create policy alumni_owner_read on alumni for select
  using (profile_id = (select auth.uid()));

drop policy if exists alumni_titulos_staff_all on alumni_titulos;
create policy alumni_titulos_staff_all on alumni_titulos for all
  using ((select is_staff()) and has_modulo('alumni'))
  with check ((select is_staff()) and has_modulo('alumni'));

drop policy if exists alumni_titulos_owner_read on alumni_titulos;
create policy alumni_titulos_owner_read on alumni_titulos for select
  using (exists (
    select 1 from alumni a
    where a.id = alumni_id and a.profile_id = (select auth.uid())
  ));

drop policy if exists titulos_mapeo_staff_all on titulos_mapeo;
create policy titulos_mapeo_staff_all on titulos_mapeo for all
  using ((select is_staff()) and has_modulo('alumni'))
  with check ((select is_staff()) and has_modulo('alumni'));

drop policy if exists alumni_act_staff_all on alumni_actualizaciones;
create policy alumni_act_staff_all on alumni_actualizaciones for all
  using ((select is_staff()) and has_modulo('alumni'))
  with check ((select is_staff()) and has_modulo('alumni'));

-- ------------------------------------------------------------
-- Resumen de títulos distintos (para la pantalla de mapeo): cuántos
-- graduados tiene cada título y su nivel/instituto predominantes.
-- Mismo patrón de gate que las vistas de 0032.
-- ------------------------------------------------------------
create or replace view v_alumni_titulos_resumen as
select
  t.titulo,
  count(distinct t.alumni_id) as graduados,
  mode() within group (order by t.nivel_formacion) as nivel_formacion,
  mode() within group (order by t.instituto) as instituto
from alumni_titulos t
where has_modulo('alumni')
group by t.titulo
order by graduados desc;
alter view v_alumni_titulos_resumen set (security_invoker = true);

-- Aplica el mapeo revisado a los títulos en una sola sentencia (evita ~mil
-- updates individuales desde la API). Devuelve cuántas filas cambió.
create or replace function aplicar_mapeo_titulos()
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not is_staff() or not has_modulo('alumni') then
    raise exception 'No autorizado';
  end if;
  update alumni_titulos t
  set carrera_id = m.carrera_id
  from titulos_mapeo m
  where m.revisado
    and m.carrera_id is not null
    and t.titulo = m.titulo_normalizado
    and t.carrera_id is distinct from m.carrera_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- ------------------------------------------------------------
-- Enlace alumni <-> profiles: cuando alguien se registra (o corrige su
-- cédula), su ficha de alumni queda vinculada a la cuenta.
-- ------------------------------------------------------------
create or replace function sync_alumni_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cedula is not null and new.cedula <> '' then
    update alumni set profile_id = new.id
    where cedula = new.cedula and profile_id is null;
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_alumni_profile on profiles;
create trigger trg_sync_alumni_profile after insert or update of cedula on profiles
  for each row execute function sync_alumni_profile();

-- Backfill para cuentas ya existentes.
update alumni a set profile_id = p.id
from profiles p
where p.cedula = a.cedula and a.profile_id is null;
