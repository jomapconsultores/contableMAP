-- ============================================================
-- 0037 — Vistas de estadística del módulo Alumni.
-- Mismo patrón que 0032: security_invoker + WHERE has_modulo('alumni')
-- (sin el módulo, la vista devuelve 0 filas en vez de los agregados).
-- ============================================================

create or replace view v_alumni_totales as
select
  (select count(*) from alumni) as personas,
  (select count(*) from alumni where email is not null) as con_email,
  (select count(*) from alumni where celular is not null) as con_celular,
  (select count(*) from alumni where estado_verificacion = 'verificado') as verificados,
  (select count(*) from alumni where estado_verificacion = 'pendiente_revision') as pendientes_revision,
  (select count(*) from alumni where profile_id is not null) as con_cuenta,
  (select count(*) from alumni_titulos) as titulos,
  (select count(*) from alumni_titulos where carrera_id is not null) as titulos_con_carrera
where has_modulo('alumni');
alter view v_alumni_totales set (security_invoker = true);

create or replace view v_alumni_por_facultad as
select
  coalesce(c.facultad, 'Sin asignar') as facultad,
  count(distinct t.alumni_id) as graduados,
  count(*) as titulos
from alumni_titulos t
left join carreras c on c.id = t.carrera_id
where has_modulo('alumni')
group by coalesce(c.facultad, 'Sin asignar')
order by graduados desc;
alter view v_alumni_por_facultad set (security_invoker = true);

create or replace view v_alumni_por_carrera as
select
  coalesce(c.nombre, 'Sin asignar') as carrera,
  coalesce(c.facultad, 'Sin asignar') as facultad,
  count(distinct t.alumni_id) as graduados,
  count(*) as titulos
from alumni_titulos t
left join carreras c on c.id = t.carrera_id
where has_modulo('alumni')
group by coalesce(c.nombre, 'Sin asignar'), coalesce(c.facultad, 'Sin asignar')
order by graduados desc;
alter view v_alumni_por_carrera set (security_invoker = true);

create or replace view v_alumni_por_anio as
select t.anio_graduacion, count(*) as titulos, count(distinct t.alumni_id) as graduados
from alumni_titulos t
where has_modulo('alumni') and t.anio_graduacion is not null
group by t.anio_graduacion
order by t.anio_graduacion;
alter view v_alumni_por_anio set (security_invoker = true);

create or replace view v_alumni_por_genero as
select coalesce(a.genero, 'sin datos') as genero, count(*) as personas
from alumni a
where has_modulo('alumni')
group by coalesce(a.genero, 'sin datos')
order by personas desc;
alter view v_alumni_por_genero set (security_invoker = true);

create or replace view v_alumni_por_nivel as
select coalesce(t.nivel_formacion, 'SIN DATOS') as nivel, count(*) as titulos,
       count(distinct t.alumni_id) as graduados
from alumni_titulos t
where has_modulo('alumni')
group by coalesce(t.nivel_formacion, 'SIN DATOS')
order by titulos desc;
alter view v_alumni_por_nivel set (security_invoker = true);

create or replace view v_alumni_ocupacion as
select a.ocupacion_categoria, count(*) as personas
from alumni a
where has_modulo('alumni')
group by a.ocupacion_categoria
order by personas desc;
alter view v_alumni_ocupacion set (security_invoker = true);

create or replace view v_alumni_institutos_externos as
select t.instituto, count(*) as titulos, count(distinct t.alumni_id) as graduados
from alumni_titulos t
where has_modulo('alumni')
  and t.instituto is not null
  and t.instituto <> 'UNIVERSIDAD DE CUENCA'
group by t.instituto
order by titulos desc;
alter view v_alumni_institutos_externos set (security_invoker = true);
