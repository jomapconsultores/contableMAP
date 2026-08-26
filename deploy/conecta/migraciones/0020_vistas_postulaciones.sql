-- admin/page.tsx e indicadores/page.tsx descargaban la tabla completa de
-- postulaciones (una fila por postulación) y agregaban en JS: personas
-- distintas que postularon en un caso, distribución por estado en el otro.
-- Se mueve la agregación a SQL, que transfiere un puñado de filas en vez de
-- toda la tabla.

-- create or replace view no permite insertar una columna en medio de las
-- existentes (solo agregar al final): postulantes_unicos va antes de
-- contratados, así que hay que recrear la vista en vez de reemplazarla.
drop view if exists v_indicadores_globales;
create view v_indicadores_globales as
select
  (select count(*) from profiles where rol='profesional') as total_graduados,
  (select count(*) from profiles where rol='profesional' and origen_padron) as graduados_verificados,
  (select count(*) from empleos where estado='publicado') as empleos_activos,
  (select count(*) from postulaciones) as postulaciones_totales,
  (select count(distinct profile_id) from postulaciones) as postulantes_unicos,
  (select count(distinct profile_id) from postulaciones where estado='contratado') as contratados,
  (select count(*) from competencias_graduado where estado='avalada') as competencias_avaladas,
  (select count(*) from servicios where activo) as servicios_activos;

create or replace view v_postulaciones_por_estado as
select estado, count(*) as cantidad
from postulaciones
group by estado;
