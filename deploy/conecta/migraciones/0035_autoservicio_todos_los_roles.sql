-- Cambio de modelo (solicitado): cualquier persona puede cambiar su rol activo
-- a CUALQUIER rol que ya tenga otorgado en roles_asignados, sea de staff o no.
--
-- Antes (0034), un usuario no-staff no podía autoservicio-cambiarse a
-- 'autoridad'/'admin' aunque tuviera ese rol otorgado, salvo la excepción
-- puntual autoservicio_staff. Ahora se elimina esa restricción: como los roles
-- de staff solo llegan a roles_asignados tras aprobación del administrador
-- (solicitudes_rol, 0033), la pertenencia a roles_asignados es autoridad
-- suficiente. Se mantiene el resto de protecciones (empresa_id, aprobado y el
-- propio flag autoservicio_staff siguen siendo intocables por sesiones
-- no-staff, y solo se puede cambiar a un rol realmente otorgado).
create or replace function protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_staff() then
    -- Solo se permite cambiar el rol activo a uno YA otorgado en roles_asignados
    -- (de cualquier nivel). Si no lo tiene otorgado, se revierte al rol previo.
    if new.rol is distinct from old.rol and not exists (
      select 1 from roles_asignados where profile_id = old.id and rol = new.rol
    ) then
      new.rol := old.rol;
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

    -- Estos siguen siendo intocables por el propio usuario no-staff.
    new.aprobado := old.aprobado;
    new.autoservicio_staff := old.autoservicio_staff;
  end if;
  return new;
end $$;
