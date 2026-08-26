-- Comprueba que las secuencias quedaron alineadas tras una migración.
--
-- Por qué importa: copiar los datos con el identificador explícito no mueve el
-- contador de la secuencia. La base parece correcta —los conteos cuadran con
-- el origen— y falla en la PRIMERA escritura con «duplicate key value violates
-- unique constraint». Una verificación que solo lee no puede detectarlo.
--
-- Uso:  docker exec -i <contenedor> psql -U postgres -d <base> -f -  < este.sql

\echo '=== secuencias: contador frente al máximo real ==='

with columnas as (
  select
    c.relname                                as tabla,
    a.attname                                as columna,
    pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), a.attname) as secuencia
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r'
),
con_secuencia as (
  select tabla, columna, secuencia from columnas where secuencia is not null
),
maximos as (
  -- El máximo se obtiene con query_to_xml porque cada tabla tiene su propia
  -- columna y no se puede escribir en una consulta plana.
  select
    s.tabla, s.columna, s.secuencia,
    coalesce((xpath('/row/max/text()',
      query_to_xml(format('select max(%I) as max from public.%I', s.columna, s.tabla),
                   false, true, '')))[1]::text::bigint, 0) as maximo_real,
    (select last_value from pg_sequences q
      where q.schemaname = 'public' and 'public.' || q.sequencename = s.secuencia) as contador
  from con_secuencia s
)
select
  tabla,
  columna,
  maximo_real,
  coalesce(contador, 0) as contador,
  case
    when maximo_real = 0                        then 'tabla vacía'
    when coalesce(contador, 0) >= maximo_real   then 'correcta'
    else                                             '*** DESALINEADA ***'
  end as estado
from maximos
order by (case when coalesce(contador, 0) >= maximo_real then 1 else 0 end), tabla;

\echo ''
\echo '=== recuento de desalineadas (debe ser 0) ==='

with columnas as (
  select c.relname as tabla, a.attname as columna,
         pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), a.attname) as secuencia
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r'
)
select count(*) as desalineadas
from columnas s
where s.secuencia is not null
  and coalesce((xpath('/row/max/text()',
        query_to_xml(format('select max(%I) as max from public.%I', s.columna, s.tabla),
                     false, true, '')))[1]::text::bigint, 0)
      > coalesce((select last_value from pg_sequences q
                   where q.schemaname='public' and 'public.'||q.sequencename = s.secuencia), 0);
