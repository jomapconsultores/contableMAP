-- Aislamiento de la base `marketing` dentro del PostgreSQL compartido.
--
-- Varias aplicaciones comparten servidor de base de datos, pero cada una debe
-- poder llegar solo a la suya. En PostgreSQL los roles son del clúster entero
-- y los permisos son por base, así que el aislamiento se construye en dos
-- pasos: un rol de conexión propio por aplicación, y cerrar el acceso
-- indiscriminado que PostgreSQL concede por defecto.
--
-- Se ejecuta conectado a la base `marketing`.

-- 1. Rol de conexión propio de Marketing.
--    PostgREST se conecta con él y luego cambia a anon o service_role según
--    el token que traiga la petición.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator_mk') then
    create role authenticator_mk with login noinherit;
  end if;
end $$;

alter role authenticator_mk with password :'clave';

-- Puede adoptar los tres roles de Supabase, pero solo dentro de esta base:
-- los permisos sobre las tablas se concedieron al aplicar el esquema.
grant anon, authenticated, service_role to authenticator_mk;

-- 2. Cerrar la puerta abierta por defecto.
--    PostgreSQL permite conectarse a cualquier base a todo el mundo (PUBLIC).
--    Sin esto, el `authenticator` de ContableMAP podría abrir una conexión
--    contra `marketing`.
revoke connect on database marketing from public;
grant  connect on database marketing to authenticator_mk, postgres;

-- 3. Y que nadie cree objetos sueltos en el esquema public.
revoke create on schema public from public;

select 'aislamiento aplicado sobre marketing' as resultado;
