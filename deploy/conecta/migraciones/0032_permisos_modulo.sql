-- ============================================================
-- 0032 — Permisos por módulo: el administrador controla a cuáles de las
-- páginas de /admin tiene acceso cada autoridad (además del rol en sí).
--
-- Revisión: la versión original de este archivo solo afectaba el control de
-- acceso a páginas (capa de aplicación) y dejaba is_staff() intacto en todas
-- las políticas RLS de las tablas/vistas de cada módulo, por lo que revocar
-- un módulo en /admin/autoridades no impedía a esa autoridad seguir leyendo
-- (o escribiendo) esos datos directamente vía PostgREST con su propio
-- access_token. Se añade has_modulo() y se conecta a la RLS real de cada
-- módulo más abajo, para que la revocación también surta efecto a nivel de
-- datos, no solo de navegación.
-- ============================================================

create table if not exists permisos_modulo (
  id           bigint generated always as identity primary key,
  profile_id   uuid not null references profiles(id) on delete cascade,
  modulo       text not null check (modulo in (
    'personas', 'empleabilidad', 'servicios', 'practicas',
    'cursos', 'indicadores', 'encuestas', 'psicometria'
  )),
  otorgado_por uuid references profiles(id),
  created_at   timestamptz not null default now(),
  unique (profile_id, modulo)
);

create index if not exists idx_permisos_modulo_profile on permisos_modulo(profile_id);

alter table permisos_modulo enable row level security;

-- Solo el propio dueño de la fila o el administrador pueden leer
-- permisos_modulo. La versión original usaba is_staff() (admin O autoridad
-- aprobada) sin filtro adicional por fila, así que cualquier autoridad podía
-- leer la tabla COMPLETA (qué módulos tiene cada autoridad del sistema,
-- incluidos módulos sensibles como 'psicometria') vía
-- /rest/v1/permisos_modulo?select=*. Ninguna pantalla de la app necesita que
-- una autoridad lea permisos ajenos: admin/layout.tsx y AutoridadModulos.tsx
-- solo consultan con `profile_id = auth.uid()` o desde una sesión de admin.
drop policy if exists permisos_modulo_owner_read on permisos_modulo;
create policy permisos_modulo_owner_read on permisos_modulo for select
  using (profile_id = (select auth.uid()) or (select current_rol()) = 'admin');

-- Comprueba si el usuario actual puede operar sobre datos del módulo
-- `p_modulo`: admin siempre; autoridad solo si tiene la fila otorgada en
-- permisos_modulo. A diferencia de is_staff() (que solo distingue
-- rol+aprobado), esta función es la que conecta el feature de "permisos por
-- módulo" con la RLS real de cada tabla/vista de módulo.
create or replace function has_modulo(p_modulo text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    (select current_rol()) = 'admin'
    or exists (
      select 1 from permisos_modulo
      where profile_id = auth.uid() and modulo = p_modulo
    );
$$;

-- Otorgar/revocar módulos es exclusivo del administrador, igual que
-- roles_asignados en 0031.
drop policy if exists permisos_modulo_admin_write on permisos_modulo;
create policy permisos_modulo_admin_write on permisos_modulo for all
  using ((select current_rol()) = 'admin') with check ((select current_rol()) = 'admin');

-- Siembra: cada autoridad aprobada existente parte con TODOS los módulos
-- (preserva el acceso que ya tiene hoy); el admin puede revocar módulos
-- específicos desde el nuevo panel /admin/autoridades.
insert into permisos_modulo (profile_id, modulo)
select id, m.modulo
from profiles,
     unnest(array['personas','empleabilidad','servicios','practicas','cursos','indicadores','encuestas','psicometria']) as m(modulo)
where rol = 'autoridad' and aprobado = true
on conflict (profile_id, modulo) do nothing;

-- Cuando una autoridad pasa a aprobada por primera vez, también parte con
-- todos los módulos por defecto.
--
-- La condición `old.aprobado is distinct from true` por sí sola no distingue
-- "primera vez" de "se re-aprobó tras un ciclo aprobado->desaprobado->
-- aprobado": se dispara en CUALQUIER transición hacia aprobado=true. Como
-- revocar un módulo hace un DELETE físico de su fila (ver
-- /api/admin/autoridades/[id]/modulos), un segundo disparo del trigger
-- reinsertaba en silencio (on conflict do nothing solo protege los módulos
-- que YA seguían existiendo) los módulos que el admin había revocado
-- explícitamente. Se añade `not exists (... permisos_modulo)` para que la
-- siembra solo ocurra realmente la primera vez (cuando la autoridad todavía
-- no tiene ninguna fila), no en cada re-aprobación.
create or replace function sembrar_permisos_modulo_autoridad()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rol = 'autoridad' and new.aprobado = true and (old.aprobado is distinct from true)
     and not exists (select 1 from permisos_modulo where profile_id = new.id) then
    insert into permisos_modulo (profile_id, modulo)
    select new.id, m.modulo
    from unnest(array['personas','empleabilidad','servicios','practicas','cursos','indicadores','encuestas','psicometria']) as m(modulo)
    on conflict (profile_id, modulo) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_sembrar_permisos_modulo on profiles;
create trigger trg_sembrar_permisos_modulo after update on profiles
  for each row execute function sembrar_permisos_modulo_autoridad();

-- ============================================================
-- Conectar has_modulo() a la RLS real de cada tabla/vista de módulo.
--
-- Antes de esto, is_staff() (admin o autoridad aprobada) bastaba para leer o
-- escribir estas tablas vía PostgREST directo, sin pasar por requireModulo()
-- ni por el menú filtrado de /admin. Se añade `and has_modulo('<modulo>')`
-- a la rama de STAFF de cada política, sin tocar las políticas de "dueño"
-- (el propio graduado/profesional siempre puede seguir leyendo/escribiendo
-- lo suyo).
-- ============================================================

-- psicometria_resultados (módulo 'psicometria'): incluye alertas de riesgo
-- psicosocial, el caso citado explícitamente en la revisión.
drop policy if exists psico_staff_read on psicometria_resultados;
create policy psico_staff_read on psicometria_resultados for select
  using (is_staff() and has_modulo('psicometria'));

-- encuestas_respuestas (módulo 'encuestas').
drop policy if exists enc_staff_read on encuestas_respuestas;
create policy enc_staff_read on encuestas_respuestas for select
  using (is_staff() and has_modulo('encuestas'));

-- documentos_personales (módulo 'personas'): tabla y storage. doc_owner /
-- doc_storage_insert (dueño) no se tocan.
drop policy if exists doc_staff_read on documentos_personales;
create policy doc_staff_read on documentos_personales for select
  using (is_staff() and has_modulo('personas'));

drop policy if exists doc_staff_delete on documentos_personales;
create policy doc_staff_delete on documentos_personales for delete
  using (is_staff() and has_modulo('personas'));

drop policy if exists doc_storage_read on storage.objects;
create policy doc_storage_read on storage.objects for select
  using (
    bucket_id = 'documentos-personales'
    and ((is_staff() and has_modulo('personas')) or (storage.foldername(name))[1] = auth.uid()::text)
  );

drop policy if exists doc_storage_delete on storage.objects;
create policy doc_storage_delete on storage.objects for delete
  using (
    bucket_id = 'documentos-personales'
    and ((is_staff() and has_modulo('personas')) or (storage.foldername(name))[1] = auth.uid()::text)
  );

-- servicios / servicio_atenciones / practicas_preprofesionales (módulos
-- 'servicios' y 'practicas'). La lectura pública de servicios
-- (cat_read_servicios, 0002_rls.sql) y de atenciones (aten_read) no se toca:
-- solo se gatea la ESCRITURA de staff, y la rama de lectura de staff sobre
-- prácticas (que sí es sensible, datos por persona).
drop policy if exists serv_write on servicios;
create policy serv_write on servicios for all
  using (is_staff() and has_modulo('servicios')) with check (is_staff() and has_modulo('servicios'));

drop policy if exists aten_write on servicio_atenciones;
create policy aten_write on servicio_atenciones for all
  using (is_staff() and has_modulo('servicios')) with check (is_staff() and has_modulo('servicios'));

drop policy if exists prac_read on practicas_preprofesionales;
create policy prac_read on practicas_preprofesionales for select
  using (profile_id = auth.uid() or (is_staff() and has_modulo('practicas')));

drop policy if exists prac_write on practicas_preprofesionales;
create policy prac_write on practicas_preprofesionales for all
  using (is_staff() and has_modulo('practicas')) with check (is_staff() and has_modulo('practicas'));

-- Vistas agregadas de indicadores (security_invoker=true desde
-- 0028_vistas_security_invoker.sql: corren con los privilegios de quien
-- consulta). No están respaldadas por una sola tabla "dueña" de un módulo
-- (v_indicadores_globales agrega profiles/empleos/postulaciones/servicios/
-- competencias_graduado a la vez), así que se gatea la vista misma con un
-- WHERE sobre has_modulo(): sin el módulo correspondiente, la vista devuelve
-- 0 filas en vez de los agregados reales.
create or replace view v_indicadores_globales as
select
  (select count(*) from profiles where rol='profesional') as total_graduados,
  (select count(*) from profiles where rol='profesional' and origen_padron) as graduados_verificados,
  (select count(*) from empleos where estado='publicado') as empleos_activos,
  (select count(*) from postulaciones) as postulaciones_totales,
  (select count(distinct profile_id) from postulaciones) as postulantes_unicos,
  (select count(distinct profile_id) from postulaciones where estado='contratado') as contratados,
  (select count(*) from competencias_graduado where estado='avalada') as competencias_avaladas,
  (select count(*) from servicios where activo) as servicios_activos
where has_modulo('indicadores');
alter view v_indicadores_globales set (security_invoker = true);

create or replace view v_empleabilidad_carrera as
with grads as (select p.id, p.carrera_id from profiles p where p.rol = 'profesional')
select c.id, c.nombre as carrera, c.facultad,
  (select count(*) from grads g where g.carrera_id = c.id) as graduados,
  (select count(distinct po.profile_id) from postulaciones po join grads g on g.id = po.profile_id where g.carrera_id = c.id) as postulantes,
  (select count(distinct po.profile_id) from postulaciones po join grads g on g.id = po.profile_id where g.carrera_id = c.id and po.estado = 'contratado') as contratados,
  (select count(*) from competencias_graduado cg join grads g on g.id = cg.profile_id where g.carrera_id = c.id and cg.estado = 'avalada') as competencias_avaladas
from carreras c
where has_modulo('empleabilidad')
order by c.nombre;
alter view v_empleabilidad_carrera set (security_invoker = true);

-- Usada tanto por /admin/servicios (módulo 'servicios') como por
-- /admin/indicadores (módulo 'indicadores'): se permite con cualquiera de
-- los dos módulos otorgados.
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
where has_modulo('servicios') or has_modulo('indicadores')
group by s.id;
alter view v_servicio_ejecucion set (security_invoker = true);

-- Solo usada en /admin/indicadores (módulo 'indicadores'); misma clase de
-- vulnerabilidad que las vistas anteriores aunque no estuviera en la lista
-- original del hallazgo.
create or replace view v_postulaciones_por_estado as
select estado, count(*) as cantidad
from postulaciones
where has_modulo('indicadores')
group by estado;
alter view v_postulaciones_por_estado set (security_invoker = true);

-- Solo usada en el informe de empleabilidad (/api/admin/informe, módulo
-- 'empleabilidad').
create or replace view v_brechas_competencias as
select
  co.id,
  co.nombre as competencia,
  co.area,
  count(distinct ec.empleo_id) as empleos_que_la_piden,
  count(distinct cg.profile_id) filter (where cg.estado = 'avalada') as graduados_con_aval
from competencias co
left join empleo_competencias ec on ec.competencia_id = co.id and ec.requerida
left join competencias_graduado cg on cg.competencia_id = co.id
where has_modulo('empleabilidad')
group by co.id
having count(distinct ec.empleo_id) > 0
order by empleos_que_la_piden desc;
alter view v_brechas_competencias set (security_invoker = true);

-- RPC revisar_curso (0016_revisar_curso_rpc.sql): is_staff() por sí solo no
-- distingue módulos, así que una autoridad a la que se le revocó 'cursos'
-- podía seguir invocando POST /api/admin/cursos/revisar directamente y
-- aprobar/rechazar cursos (avalando competencias con código de
-- verificación). Se exige además has_modulo('cursos') como defensa en
-- profundidad a nivel de base de datos, además de la comprobación que ahora
-- hace la propia ruta API.
create or replace function revisar_curso(p_profile_id uuid, p_curso_id bigint, p_aprobar boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_competencia_id bigint;
  v_estado_actual estado_curso;
  v_nuevo_estado estado_curso;
begin
  if not is_staff() or not has_modulo('cursos') then
    raise exception 'No autorizado';
  end if;

  select estado into v_estado_actual
  from inscripciones_curso
  where profile_id = p_profile_id and curso_id = p_curso_id;

  if v_estado_actual is null then
    raise exception 'No existe una inscripción para revisar.';
  end if;
  if v_estado_actual <> 'pendiente_revision' then
    raise exception 'Este curso no está pendiente de revisión.';
  end if;

  v_nuevo_estado := case when p_aprobar then 'aprobado' else 'reprobado' end::estado_curso;

  select competencia_id into v_competencia_id from cursos where id = p_curso_id;

  update inscripciones_curso
  set estado = v_nuevo_estado,
      fecha_aprobacion = case when p_aprobar then now() else fecha_aprobacion end
  where profile_id = p_profile_id and curso_id = p_curso_id;

  if p_aprobar and v_competencia_id is not null then
    insert into competencias_graduado
      (profile_id, competencia_id, estado, avalada_por, fecha_aval, curso_id, codigo_verificacion)
    values (
      p_profile_id, v_competencia_id, 'avalada', 'Universidad — Educación Continua', now(), p_curso_id,
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
    )
    on conflict (profile_id, competencia_id) do update set
      estado = 'avalada',
      avalada_por = 'Universidad — Educación Continua',
      fecha_aval = now(),
      curso_id = p_curso_id,
      codigo_verificacion = coalesce(competencias_graduado.codigo_verificacion, excluded.codigo_verificacion);
  end if;

  return jsonb_build_object(
    'estado', v_nuevo_estado,
    'competencia_avalada', p_aprobar and v_competencia_id is not null
  );
end;
$$;
