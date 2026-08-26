-- Recoloca todas las secuencias al máximo real de su columna.
--
-- El migrador ya lo hace al terminar, pero buscaba las secuencias por
-- `pg_depend` con deptype 'a', que solo encuentra las que están declaradas
-- OWNED BY su columna. Una secuencia creada aparte —o cuya pertenencia se
-- perdió al reconstruir el esquema— se queda fuera y su contador sigue en 1.
--
-- `pg_get_serial_sequence` no depende de eso: resuelve la secuencia desde el
-- valor por defecto de la columna, que es como la usa PostgreSQL al insertar.
--
-- Es idempotente: puede ejecutarse las veces que haga falta.

do $$
declare
  fila record;
  maximo bigint;
begin
  for fila in
    select c.relname as tabla,
           a.attname as columna,
           pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), a.attname) as secuencia
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    continue when fila.secuencia is null;

    execute format('select coalesce(max(%I), 0) from public.%I', fila.columna, fila.tabla) into maximo;

    -- Con is_called = true, el siguiente nextval() devuelve maximo + 1.
    -- Una tabla vacía deja la secuencia en 1 sin marcarla como usada.
    if maximo > 0 then
      execute format('select setval(%L, %s, true)', fila.secuencia, maximo);
    else
      execute format('select setval(%L, 1, false)', fila.secuencia);
    end if;
  end loop;
end $$;

select 'secuencias alineadas' as resultado;
