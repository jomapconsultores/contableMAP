-- Roles propios de GoTrue y storage-api para la base `gestion`.
--
-- La imagen de Supabase crea `supabase_auth_admin` y `supabase_storage_admin`
-- como roles del clúster, con una única contraseña: la que se fijó al
-- inicializar el primer stack. Reutilizarlos aquí obligaría a compartir esa
-- contraseña entre bases, y además les daría acceso a las dos —justo lo que el
-- aislamiento pretende evitar—.
--
-- GoTrue y storage-api no exigen llamarse de una forma concreta: usan el
-- usuario de su cadena de conexión y crean sus esquemas siendo dueños de
-- ellos. Así que cada base tiene los suyos.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'auth_admin_ge') then
    create role auth_admin_ge with login createrole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'storage_admin_ge') then
    create role storage_admin_ge with login createrole;
  end if;
end $$;

alter role auth_admin_ge    with password :'clave';
alter role storage_admin_ge with password :'clave';

-- Crear su esquema y trabajar dentro de esta base, y solo de esta.
grant connect, create on database gestion to auth_admin_ge, storage_admin_ge;
grant create, usage on schema public to auth_admin_ge, storage_admin_ge;

-- Necesitan conceder permisos sobre lo que creen a los roles de la API.
grant anon, authenticated, service_role to auth_admin_ge, storage_admin_ge;

-- Y se retira el acceso de los roles compartidos, que no pintan nada aquí.
revoke all on database gestion from supabase_auth_admin, supabase_storage_admin;

select 'roles de servicio creados para gestion' as resultado;
