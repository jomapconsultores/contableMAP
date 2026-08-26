-- Vacía el esquema `public` del destino antes de una recarga limpia.
--
-- Se usa justo antes del corte: la primera copia pudo quedar desfasada si algo
-- se modificó en el origen —y un recuento de filas idéntico no lo detectaría,
-- porque un UPDATE no cambia el número de filas—. Recargar de cero es más
-- barato que averiguar qué cambió.
--
-- No toca `auth` ni `storage`: los usuarios ya tienen contraseña establecida y
-- los archivos ya están subidos. Solo se vacía la contabilidad.
--
-- Seguro de ejecutar: el origen en supabase.com sigue siendo la fuente hasta
-- que se cambien las variables de la aplicación.

do $$
declare
  tablas text;
begin
  -- Sin esto, TRUNCATE se pelearía con las claves foráneas entre asientos,
  -- movimientos y cartera.
  set session_replication_role = replica;

  select string_agg(format('public.%I', tablename), ', ')
    into tablas
  from pg_tables
  where schemaname = 'public';

  if tablas is not null then
    execute format('truncate table %s restart identity cascade', tablas);
  end if;
end $$;

select count(*) as tablas_vacias from pg_tables where schemaname = 'public';
