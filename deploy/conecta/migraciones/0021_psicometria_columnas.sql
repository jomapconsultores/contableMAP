-- "respuestas" (el detalle ítem por ítem) nunca se lee de vuelta en ningún
-- consumidor de la app: ni el propio dueño ni el staff la necesitan, solo se
-- usa para calcular puntuaciones al insertar. RLS es por fila, no por
-- columna, así que cualquier cuenta de staff podía pedir esa columna
-- explícitamente vía la API REST aunque la UI nunca la solicite. Se revoca
-- el SELECT general y se otorga solo sobre las columnas que sí se leen.
revoke select on psicometria_resultados from authenticated;
grant select (id, profile_id, tipo, puntuaciones, interpretacion, alerta, created_at)
  on psicometria_resultados to authenticated;
