-- ============================================================
-- 0010 — Corrige registro de autoridad/empleador (cédula vacía)
-- ============================================================
-- Bug: profiles.cedula tiene UNIQUE. Autoridad y empleador no piden cédula en el
-- formulario, así que el trigger de alta insertaba '' (cadena vacía, no NULL). La
-- primera cuenta de ese tipo se creaba bien; la SEGUNDA (autoridad o empleador)
-- chocaba con la restricción UNIQUE sobre '' y el registro fallaba con un error
-- crudo de Postgres, sin llegar nunca a /pendiente para esperar la aprobación.

-- Libera cualquier fila ya afectada (cédula vacía en vez de nula).
update profiles set cedula = null where cedula = '';

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_cedula text := nullif(new.raw_user_meta_data->>'cedula', '');
  v_rol_txt text := coalesce(new.raw_user_meta_data->>'rol', 'profesional');
  v_rol rol_usuario;
  v_empresa_nombre text := new.raw_user_meta_data->>'empresa_nombre';
  v_empresa_id bigint;
  v_aprobado boolean;
  p graduados_padron%rowtype;
begin
  if v_rol_txt = 'graduado' then v_rol_txt := 'profesional'; end if;
  begin
    v_rol := v_rol_txt::rol_usuario;
  exception when others then
    v_rol := 'profesional';
  end;
  -- nadie se auto-registra como administrador
  if v_rol = 'admin' then v_rol := 'autoridad'; end if;
  v_aprobado := (v_rol <> 'autoridad');

  select * into p from graduados_padron where cedula = v_cedula;

  if v_rol = 'empleador' and coalesce(v_empresa_nombre, '') <> '' then
    insert into empresas (nombre, contacto_email, validada)
    values (v_empresa_nombre, new.email, false)
    returning id into v_empresa_id;
  end if;

  insert into profiles (id, rol, cedula, nombres, apellidos, carrera_id,
                        anio_graduacion, titulo, email, telefono, ciudad,
                        origen_padron, empresa_id, aprobado)
  values (
    new.id, v_rol, v_cedula,
    coalesce(p.nombres, new.raw_user_meta_data->>'nombres'),
    coalesce(p.apellidos, new.raw_user_meta_data->>'apellidos'),
    p.carrera_id, p.anio_graduacion, p.titulo, new.email, p.telefono, p.ciudad,
    (p.cedula is not null), v_empresa_id, v_aprobado
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
