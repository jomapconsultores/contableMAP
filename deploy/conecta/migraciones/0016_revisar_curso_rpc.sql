-- Flujo de revisión de cursos internos (reemplaza el auto-aval del graduado).
--
-- Ambas funciones deben invocarse con el cliente autenticado normal (no con
-- service role): dependen de que auth.uid() refleje al usuario real que
-- llama, tanto para resolver de quién es la inscripción (enviar_revision_curso)
-- como para la comprobación is_staff() (revisar_curso). Además,
-- protect_inscripcion_privileges / protect_competencia_privileges
-- (0012_rls_hardening.sql) siguen actuando como defensa en profundidad: si
-- quien llama no es staff, cualquier intento de escribir 'aprobado' o
-- 'reprobado' es revertido por el trigger sin importar qué haga esta función.

create or replace function enviar_revision_curso(p_curso_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_estado_actual estado_curso;
begin
  if v_profile_id is null then
    raise exception 'No autenticado';
  end if;

  select estado into v_estado_actual
  from inscripciones_curso
  where profile_id = v_profile_id and curso_id = p_curso_id;

  if v_estado_actual is null then
    raise exception 'Debes inscribirte en el curso antes de enviarlo a revisión.';
  end if;
  if v_estado_actual not in ('en_progreso', 'reprobado') then
    raise exception 'Este curso no está en un estado que permita enviarlo a revisión.';
  end if;

  update inscripciones_curso
  set estado = 'pendiente_revision'
  where profile_id = v_profile_id and curso_id = p_curso_id;

  return jsonb_build_object('estado', 'pendiente_revision');
end;
$$;

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
  if not is_staff() then
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
