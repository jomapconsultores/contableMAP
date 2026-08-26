-- ============================================================
-- 0031 — Multi-rol: una persona puede tener varios roles asignados y
-- cambiar cuál es su "rol activo" (el que ya usan is_staff()/current_rol()
-- y todas las políticas RLS existentes) desde un selector de la propia
-- cuenta, sin tocar ninguna política existente.
-- ============================================================

create table if not exists roles_asignados (
  id           bigint generated always as identity primary key,
  profile_id   uuid not null references profiles(id) on delete cascade,
  rol          rol_usuario not null,
  empresa_id   bigint references empresas(id), -- solo relevante si rol='empleador'
  otorgado_por uuid references profiles(id),
  created_at   timestamptz not null default now(),
  unique (profile_id, rol)
);

create index if not exists idx_roles_asignados_profile on roles_asignados(profile_id);

alter table roles_asignados enable row level security;

drop policy if exists roles_asignados_owner_read on roles_asignados;
create policy roles_asignados_owner_read on roles_asignados for select
  using (profile_id = (select auth.uid()) or (select is_staff()));

-- Otorgar/revocar roles es exclusivo del administrador (no de autoridad,
-- aunque autoridad sí pueda leer esta tabla vía roles_asignados_owner_read).
drop policy if exists roles_asignados_staff_write on roles_asignados;
drop policy if exists roles_asignados_admin_write on roles_asignados;
create policy roles_asignados_admin_write on roles_asignados for all
  using ((select current_rol()) = 'admin') with check ((select current_rol()) = 'admin');

-- Siembra: cada profile existente conserva su rol actual como su único rol
-- asignado inicial, para que la lista de roles disponibles nunca empiece vacía.
insert into roles_asignados (profile_id, rol, empresa_id)
select id, rol, empresa_id from profiles
on conflict (profile_id, rol) do nothing;

-- Registra el rol inicial como asignado en cada alta nueva.
create or replace function sembrar_rol_asignado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into roles_asignados (profile_id, rol, empresa_id)
  values (new.id, new.rol, new.empresa_id)
  on conflict (profile_id, rol) do nothing;
  return new;
end $$;

drop trigger if exists trg_sembrar_rol_asignado on profiles;
create trigger trg_sembrar_rol_asignado after insert on profiles
  for each row execute function sembrar_rol_asignado();

-- Extiende protect_profile_privileges (0008_seguridad.sql): antes bloqueaba
-- CUALQUIER cambio de "rol" para una sesión no-staff. Ahora permite el
-- autoservicio de "cambiar mi rol activo" únicamente hacia un rol que el
-- staff ya le otorgó explícitamente en roles_asignados, y nunca hacia
-- 'admin' ni 'autoridad' (esos siguen exclusivos del flujo de aprobación /
-- asignación directa existente, no de este selector). empresa_id solo se
-- actualiza junto con un cambio válido hacia 'empleador', tomado del propio
-- otorgamiento en roles_asignados — nunca de un valor que mande el cliente.
-- Si el rol activo deja de ser 'empleador' (por autoservicio o por cualquier
-- otro camino), empresa_id se limpia a null: varias políticas RLS
-- preexistentes (empleos_emp_write, empleocomp_write, post_emp_read/update,
-- etc.) autorizan comparando solo profiles.empresa_id, sin exigir
-- rol='empleador', así que dejar un empresa_id obsoleto filtraría privilegios
-- de "empleador" a una cuenta que ya cambió (o a la que se le revocó) ese rol.
create or replace function protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_staff() then
    if new.rol is distinct from old.rol then
      if new.rol in ('admin', 'autoridad')
         or not exists (
           select 1 from roles_asignados
           where profile_id = old.id and rol = new.rol
         ) then
        new.rol := old.rol;
      end if;
    end if;

    if new.rol = 'empleador' then
      if new.rol is distinct from old.rol then
        new.empresa_id := (
          select empresa_id from roles_asignados
          where profile_id = old.id and rol = 'empleador'
        );
      else
        new.empresa_id := old.empresa_id;
      end if;
    else
      new.empresa_id := null;
    end if;

    new.aprobado := old.aprobado;
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_profile_privileges on profiles;
create trigger trg_protect_profile_privileges before update on profiles
  for each row execute function protect_profile_privileges();
