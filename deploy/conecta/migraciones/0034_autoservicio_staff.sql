-- Excepción puntual y auditable a la protección anti-escalamiento: por
-- defecto NADIE puede autoservicio-cambiarse a 'autoridad'/'admin' aunque ya
-- tenga ese rol otorgado en roles_asignados (protect_profile_privileges,
-- 0008/0031). Este flag, exclusivo del administrador, habilita esa
-- excepción SOLO para la cuenta marcada — pensado para cuentas de
-- demostración que necesitan mostrar todas las vistas del sistema sin
-- depender de que un admin les cambie el rol manualmente cada vez.
alter table profiles add column autoservicio_staff boolean not null default false;

create or replace function protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_staff() then
    if new.rol is distinct from old.rol then
      if new.rol in ('admin', 'autoridad') then
        if not (
          old.autoservicio_staff
          and exists (select 1 from roles_asignados where profile_id = old.id and rol = new.rol)
        ) then
          new.rol := old.rol;
        end if;
      elsif not exists (
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
    -- Solo el administrador otorga esta excepción; una sesión no-staff
    -- nunca puede activarla (ni desactivarla) sobre sí misma.
    new.autoservicio_staff := old.autoservicio_staff;
  end if;
  return new;
end $$;
