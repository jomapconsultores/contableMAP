-- Cierra el hueco de auto-escalamiento de privilegios encontrado en revisión:
-- las políticas *_owner de competencias_graduado, inscripciones_curso y postulaciones
-- son "for all" sin restricción de columnas, así que cualquier usuario autenticado
-- podía llamar directo a la API REST de Supabase y auto-otorgarse un aval, aprobar
-- su propio curso o marcarse a sí mismo como contratado con un match_score inventado.
-- Mismo patrón que protect_profile_privileges (0008_seguridad.sql), aplicado aquí.

create or replace function protect_competencia_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_staff() then
    if tg_op = 'INSERT' then
      new.estado := 'autodeclarada';
      new.avalada_por := null;
      new.fecha_aval := null;
      new.codigo_verificacion := null;
      new.curso_id := null;
    elsif tg_op = 'UPDATE' then
      new.estado := old.estado;
      new.avalada_por := old.avalada_por;
      new.fecha_aval := old.fecha_aval;
      new.codigo_verificacion := old.codigo_verificacion;
      new.curso_id := old.curso_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_competencia_privileges on competencias_graduado;
create trigger trg_protect_competencia_privileges before insert or update on competencias_graduado
  for each row execute function protect_competencia_privileges();

create or replace function protect_inscripcion_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_staff() then
    if tg_op = 'INSERT' then
      if new.estado in ('aprobado', 'reprobado') then new.estado := 'inscrito'; end if;
      new.fecha_aprobacion := null;
    elsif tg_op = 'UPDATE' then
      -- Bloquea CUALQUIER transición hacia aprobado/reprobado, sin importar el
      -- estado anterior (evita el bypass de reprobado -> aprobado en un solo PATCH).
      if new.estado in ('aprobado', 'reprobado') then
        new.estado := old.estado;
      end if;
      new.curso_id := old.curso_id;
      new.fecha_aprobacion := old.fecha_aprobacion;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_inscripcion_privileges on inscripciones_curso;
create trigger trg_protect_inscripcion_privileges before insert or update on inscripciones_curso
  for each row execute function protect_inscripcion_privileges();

create or replace function protect_postulacion_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_staff() then
    if tg_op = 'INSERT' then
      if new.estado not in ('borrador', 'enviada') then new.estado := 'enviada'; end if;
      new.match_score := null;
      new.ia_analisis := null;
    elsif tg_op = 'UPDATE' then
      if new.estado not in ('borrador', 'enviada') then new.estado := old.estado; end if;
      new.match_score := old.match_score;
      new.ia_analisis := old.ia_analisis;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_postulacion_privileges on postulaciones;
create trigger trg_protect_postulacion_privileges before insert or update on postulaciones
  for each row execute function protect_postulacion_privileges();

-- Caché de un solo uso del resultado de la consulta en vivo a SENESCYT (server-side),
-- para que /api/senescyt/live/importar no dependa de titulos/cursos/nombre enviados
-- por el cliente (que un usuario podía falsificar para inyectar títulos no verificados).
create table if not exists senescyt_live_cache (
  profile_id uuid primary key references profiles(id) on delete cascade,
  nombre     text,
  titulos    jsonb not null default '[]'::jsonb,
  cursos     jsonb not null default '[]'::jsonb,
  creado     timestamptz not null default now()
);
alter table senescyt_live_cache enable row level security;
-- Sin políticas de owner: solo se accede vía service role desde las rutas del servidor.
