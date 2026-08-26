-- Cierra `anon` en los proyectos de supabase.com ya migrados.
--
-- POR QUÉ
--
-- Los repositorios `atlas-sistema` y `calendarios-map-app` son PÚBLICOS y
-- llevan su clave `anon` en el historial de git. Quitarla en un commit
-- posterior no la borra del historial. En los dos proyectos de origen `anon`
-- conserva SELECT sobre 21 y 39 tablas respectivamente, y no hay ni una
-- política RLS en `public` que lo limite. Es decir: cualquiera puede sacar la
-- clave del repositorio y leer estudiantes, padres de familia, pagos,
-- `google_tokens`, `ms_tokens`, `webauthn_credentials` y `face_descriptors`.
--
-- Comprobado antes de escribir esto: ninguno de los dos proyectos tiene Edge
-- Functions ni funciones SECURITY DEFINER, y las aplicaciones ya no los usan
-- —entran con `service_role` contra el servidor propio—. Revocar aquí no
-- rompe nada y no estorba la vuelta atrás.
--
-- Esto corta el acceso, pero NO invalida la clave: hay que rotarla además en
-- el panel de cada proyecto.
--
-- Uso: pegar en el editor SQL del panel de cada proyecto.

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
select count(distinct table_name) as tablas_visibles_para_anon
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';
