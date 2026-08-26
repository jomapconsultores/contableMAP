-- "Contratados" se calculaba con semánticas distintas en dos vistas:
-- v_indicadores_globales contaba FILAS de postulaciones con estado='contratado'
-- (un graduado con 2 postulaciones contratadas contaba 2 veces), mientras que
-- v_empleabilidad_carrera ya contaba PERSONAS distintas. El mismo dato
-- reportado a acreditación difería entre el panel de admin, la página de
-- indicadores y el PDF exportable (que usa ambas vistas en el mismo informe).
-- Se unifica a "personas distintas", la semántica correcta para un indicador
-- de inserción laboral.
create or replace view v_indicadores_globales as
select
  (select count(*) from profiles where rol='profesional') as total_graduados,
  (select count(*) from profiles where rol='profesional' and origen_padron) as graduados_verificados,
  (select count(*) from empleos where estado='publicado') as empleos_activos,
  (select count(*) from postulaciones) as postulaciones_totales,
  (select count(distinct profile_id) from postulaciones where estado='contratado') as contratados,
  (select count(*) from competencias_graduado where estado='avalada') as competencias_avaladas,
  (select count(*) from servicios where activo) as servicios_activos;
