-- ============================================================
-- 0038 — Directorio unificado de personas.
--
-- /admin/personas debe listar a TODAS las personas de la base: las cuentas
-- registradas (profiles con rol estudiante/profesional) y los graduados
-- importados al módulo Alumni que aún no tienen cuenta. Cuando un graduado
-- crea su cuenta, alumni.profile_id se enlaza (trigger de 0036) y la persona
-- aparece una sola vez, como cuenta.
--
-- Búsqueda: índices trigram (pg_trgm) para que los ilike '%q%' del buscador
-- sean por índice y no por barrido, y respondan rápido aunque el registro
-- crezca muy por encima de los ~3.5k actuales.
-- ============================================================

create extension if not exists pg_trgm;

create index if not exists idx_alumni_trgm_apellidos on alumni using gin (apellidos gin_trgm_ops);
create index if not exists idx_alumni_trgm_nombres   on alumni using gin (nombres gin_trgm_ops);
create index if not exists idx_alumni_trgm_email     on alumni using gin (email gin_trgm_ops);
create index if not exists idx_alumni_trgm_cedula    on alumni using gin (cedula gin_trgm_ops);

-- Vista de directorio. security_invoker + has_modulo('personas'), como el
-- resto de vistas de módulo (0032). Nota: la mitad de alumni además pasa por
-- la RLS de la tabla alumni (has_modulo('alumni')), de modo que una autoridad
-- con 'personas' pero sin 'alumni' ve solo las cuentas — coherente con el
-- modelo de permisos por módulo.
create or replace view v_personas_directorio as
select
  'cuenta'::text as tipo,
  p.id::text as ref,
  p.nombres,
  p.apellidos,
  p.cedula,
  p.email,
  p.telefono,
  p.rol::text as rol,
  c.nombre as carrera,
  null::text as titulo_reciente,
  null::bigint as titulos
from profiles p
left join carreras c on c.id = p.carrera_id
where p.rol in ('estudiante', 'profesional')
  and has_modulo('personas')
union all
select
  'alumni'::text,
  a.id::text,
  a.nombres,
  a.apellidos,
  a.cedula,
  a.email,
  coalesce(a.celular, a.telefono_fijo),
  'alumni'::text,
  c.nombre,
  t.titulo_reciente,
  t.titulos
from alumni a
left join lateral (
  select
    count(*) as titulos,
    (array_agg(at.titulo order by at.anio_graduacion desc nulls last))[1] as titulo_reciente,
    (array_agg(at.carrera_id order by at.anio_graduacion desc nulls last)
       filter (where at.carrera_id is not null))[1] as carrera_id
  from alumni_titulos at
  where at.alumni_id = a.id
) t on true
left join carreras c on c.id = t.carrera_id
where a.profile_id is null
  and has_modulo('personas');
alter view v_personas_directorio set (security_invoker = true);
