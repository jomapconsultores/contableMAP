-- Retira a `anon` todo acceso al esquema public.
--
-- POR QUÉ EXISTE ESTE ARCHIVO
--
-- En Supabase, la protección de una tabla puede venir de dos sitios: de las
-- políticas RLS o de los privilegios concedidos a cada rol. Extraer el esquema
-- del catálogo reconstruye tablas, índices, restricciones y políticas —pero
-- los privilegios no viven ahí—, y la imagen `supabase/postgres` concede a
-- `anon` permisos por defecto sobre lo que se va creando.
--
-- Resultado en una base sin RLS: el esquema es idéntico al del origen y los
-- permisos no. La API queda respondiendo con la clave anónima, o directamente
-- sin clave, a cualquiera que conozca el dominio.
--
-- Aquí eso expuso `usuarios` (con su hash de contraseña) y `google_tokens`
-- (con un token OAuth vivo) en internet, con certificado válido.
--
-- Las aplicaciones de atlas y calendario entran con la clave `service_role`,
-- así que `anon` no necesita absolutamente nada.

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke usage on schema public from anon;

-- Y que lo que se cree en el futuro tampoco le llegue por defecto.
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- service_role conserva lo suyo: es con quien entran las aplicaciones.
grant usage on schema public to service_role;
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

select 'anon sin acceso · service_role conserva permisos' as resultado;
