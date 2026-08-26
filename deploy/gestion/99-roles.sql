-- Contraseñas de los roles internos de Supabase.
--
-- La imagen `supabase/postgres` ya crea los roles (anon, authenticated,
-- service_role, authenticator, supabase_auth_admin, supabase_storage_admin),
-- pero sin contraseña: GoTrue, PostgREST y Storage no podrían conectarse.
--
-- Se ejecuta una sola vez, cuando el directorio de datos está vacío. Si más
-- adelante hay que rotar la contraseña, no basta con cambiar el .env: hay que
-- correr estos ALTER a mano contra la base ya inicializada.
--
-- `\set` con acento grave delega en el shell, que es como el compose oficial
-- lee la contraseña sin dejarla escrita en el repositorio.

\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
