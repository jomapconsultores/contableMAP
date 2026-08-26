create or replace function protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_staff() then
    new.rol := old.rol;
    new.aprobado := old.aprobado;
    new.empresa_id := old.empresa_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_profile_privileges on profiles;
create trigger trg_protect_profile_privileges before update on profiles for each row execute function protect_profile_privileges();

drop policy if exists profiles_read_staff_emp on profiles;
drop policy if exists profiles_read_staff on profiles;
drop policy if exists profiles_read_emp_postulantes on profiles;
create policy profiles_read_staff on profiles for select using (is_staff());
create policy profiles_read_emp_postulantes on profiles for select using (exists (select 1 from postulaciones po join empleos e on e.id = po.empleo_id join profiles emp on emp.id = auth.uid() where po.profile_id = profiles.id and emp.rol = 'empleador' and emp.empresa_id is not null and e.empresa_id = emp.empresa_id));

drop policy if exists exp_read_staff_emp on experiencia_laboral;
drop policy if exists exp_read_staff on experiencia_laboral;
drop policy if exists exp_read_emp on experiencia_laboral;
create policy exp_read_staff on experiencia_laboral for select using (is_staff());
create policy exp_read_emp on experiencia_laboral for select using (exists (select 1 from postulaciones po join empleos e on e.id = po.empleo_id join profiles emp on emp.id = auth.uid() where po.profile_id = experiencia_laboral.profile_id and emp.rol = 'empleador' and emp.empresa_id is not null and e.empresa_id = emp.empresa_id));

drop policy if exists edu_read_staff_emp on educacion;
drop policy if exists edu_read_staff on educacion;
drop policy if exists edu_read_emp on educacion;
create policy edu_read_staff on educacion for select using (is_staff());
create policy edu_read_emp on educacion for select using (exists (select 1 from postulaciones po join empleos e on e.id = po.empleo_id join profiles emp on emp.id = auth.uid() where po.profile_id = educacion.profile_id and emp.rol = 'empleador' and emp.empresa_id is not null and e.empresa_id = emp.empresa_id));

drop policy if exists hab_read_staff_emp on habilidades;
drop policy if exists hab_read_staff on habilidades;
drop policy if exists hab_read_emp on habilidades;
create policy hab_read_staff on habilidades for select using (is_staff());
create policy hab_read_emp on habilidades for select using (exists (select 1 from postulaciones po join empleos e on e.id = po.empleo_id join profiles emp on emp.id = auth.uid() where po.profile_id = habilidades.profile_id and emp.rol = 'empleador' and emp.empresa_id is not null and e.empresa_id = emp.empresa_id));

drop policy if exists compg_read_staff_emp on competencias_graduado;
drop policy if exists compg_read_staff on competencias_graduado;
drop policy if exists compg_read_emp on competencias_graduado;
create policy compg_read_staff on competencias_graduado for select using (is_staff());
create policy compg_read_emp on competencias_graduado for select using (exists (select 1 from postulaciones po join empleos e on e.id = po.empleo_id join profiles emp on emp.id = auth.uid() where po.profile_id = competencias_graduado.profile_id and emp.rol = 'empleador' and emp.empresa_id is not null and e.empresa_id = emp.empresa_id));

drop policy if exists cv_read_staff_emp on cvs;
drop policy if exists cv_read_staff on cvs;
drop policy if exists cv_read_emp on cvs;
create policy cv_read_staff on cvs for select using (is_staff());
create policy cv_read_emp on cvs for select using (exists (select 1 from postulaciones po join empleos e on e.id = po.empleo_id join profiles emp on emp.id = auth.uid() where po.profile_id = cvs.profile_id and emp.rol = 'empleador' and emp.empresa_id is not null and e.empresa_id = emp.empresa_id));

drop policy if exists retro_emp on retroalimentacion_empresa;
create policy retro_emp on retroalimentacion_empresa for all
  using (is_staff() or exists (select 1 from postulaciones p join empleos e on e.id = p.empleo_id join profiles pr on pr.empresa_id = e.empresa_id where p.id = retroalimentacion_empresa.postulacion_id and pr.id = auth.uid()))
  with check (is_staff() or exists (select 1 from postulaciones p join empleos e on e.id = p.empleo_id join profiles pr on pr.empresa_id = e.empresa_id where p.id = retroalimentacion_empresa.postulacion_id and pr.id = auth.uid()));

create or replace view v_indicadores_globales as
select
  (select count(*) from profiles where rol='profesional') as total_graduados,
  (select count(*) from profiles where rol='profesional' and origen_padron) as graduados_verificados,
  (select count(*) from empleos where estado='publicado') as empleos_activos,
  (select count(*) from postulaciones) as postulaciones_totales,
  (select count(*) from postulaciones where estado='contratado') as contratados,
  (select count(*) from competencias_graduado where estado='avalada') as competencias_avaladas,
  (select count(*) from servicios where activo) as servicios_activos;

create or replace view v_empleabilidad_carrera as
with grads as (select p.id, p.carrera_id from profiles p where p.rol = 'profesional')
select c.id, c.nombre as carrera, c.facultad,
  (select count(*) from grads g where g.carrera_id = c.id) as graduados,
  (select count(distinct po.profile_id) from postulaciones po join grads g on g.id = po.profile_id where g.carrera_id = c.id) as postulantes,
  (select count(distinct po.profile_id) from postulaciones po join grads g on g.id = po.profile_id where g.carrera_id = c.id and po.estado = 'contratado') as contratados,
  (select count(*) from competencias_graduado cg join grads g on g.id = cg.profile_id where g.carrera_id = c.id and cg.estado = 'avalada') as competencias_avaladas
from carreras c order by c.nombre;
