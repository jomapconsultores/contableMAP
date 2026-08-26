-- ============================================================
-- 0018 — Rendimiento: índices de FK faltantes + RLS auth_rls_initplan
-- ============================================================

-- --- Índices en columnas de FK de alto tráfico sin índice propio ---
-- (inscripciones_curso ya está cubierta por su UNIQUE (profile_id, curso_id):
-- profile_id es la columna líder, así que ese índice ya sirve para filtrar
-- solo por profile_id sin necesitar uno adicional.)
create index if not exists idx_experiencia_laboral_profile on experiencia_laboral(profile_id);
create index if not exists idx_educacion_profile on educacion(profile_id);
create index if not exists idx_habilidades_profile on habilidades(profile_id);
create index if not exists idx_postulaciones_profile on postulaciones(profile_id);
create index if not exists idx_practicas_preprofesionales_profile on practicas_preprofesionales(profile_id);
create index if not exists idx_servicio_atenciones_servicio on servicio_atenciones(servicio_id);

-- --- profiles: filtro caliente por rol/aprobado + búsqueda por texto ---
create index if not exists idx_profiles_rol_aprobado on profiles(rol, aprobado);

create extension if not exists pg_trgm;
create index if not exists idx_profiles_nombres_trgm on profiles using gin (nombres gin_trgm_ops);
create index if not exists idx_profiles_apellidos_trgm on profiles using gin (apellidos gin_trgm_ops);
create index if not exists idx_profiles_cedula_trgm on profiles using gin (cedula gin_trgm_ops);
create index if not exists idx_profiles_email_trgm on profiles using gin (email gin_trgm_ops);

-- ============================================================
-- RLS: is_staff()/current_rol() envueltas en (select ...) para que el
-- planner las resuelva una sola vez por consulta (InitPlan) en vez de
-- reevaluarlas por cada fila candidata. No cambia ninguna política de
-- EXISTS(...) correlacionada (esas sí necesitan evaluarse por fila, son
-- ownership checks reales) — solo las llamadas "sueltas" a is_staff()/
-- current_rol().
-- ============================================================

drop policy if exists padron_staff_read on graduados_padron;
create policy padron_staff_read on graduados_padron for select using ((select is_staff()));

drop policy if exists profiles_read_staff on profiles;
create policy profiles_read_staff on profiles for select using ((select is_staff()));

drop policy if exists exp_read_staff on experiencia_laboral;
create policy exp_read_staff on experiencia_laboral for select using ((select is_staff()));

drop policy if exists edu_read_staff on educacion;
create policy edu_read_staff on educacion for select using ((select is_staff()));

drop policy if exists hab_read_staff on habilidades;
create policy hab_read_staff on habilidades for select using ((select is_staff()));

drop policy if exists compg_read_staff on competencias_graduado;
create policy compg_read_staff on competencias_graduado for select using ((select is_staff()));

drop policy if exists cv_read_staff on cvs;
create policy cv_read_staff on cvs for select using ((select is_staff()));

drop policy if exists empresas_read on empresas;
create policy empresas_read on empresas for select using (validada or (select is_staff()));

drop policy if exists empresas_staff_write on empresas;
create policy empresas_staff_write on empresas for all
  using ((select is_staff())) with check ((select is_staff()));

drop policy if exists empleos_read_pub on empleos;
create policy empleos_read_pub on empleos for select
  using (estado = 'publicado' or (select is_staff())
         or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.empresa_id = empleos.empresa_id));

drop policy if exists empleos_emp_write on empleos;
create policy empleos_emp_write on empleos for all
  using (exists (select 1 from profiles pr where pr.id = auth.uid() and pr.empresa_id = empleos.empresa_id) or (select is_staff()))
  with check (exists (select 1 from profiles pr where pr.id = auth.uid() and pr.empresa_id = empleos.empresa_id) or (select is_staff()));

drop policy if exists empleocomp_write on empleo_competencias;
create policy empleocomp_write on empleo_competencias for all
  using ((select is_staff()) or exists (
    select 1 from empleos e join profiles pr on pr.empresa_id = e.empresa_id
    where e.id = empleo_competencias.empleo_id and pr.id = auth.uid()))
  with check ((select is_staff()) or exists (
    select 1 from empleos e join profiles pr on pr.empresa_id = e.empresa_id
    where e.id = empleo_competencias.empleo_id and pr.id = auth.uid()));

drop policy if exists post_emp_read on postulaciones;
create policy post_emp_read on postulaciones for select
  using ((select is_staff()) or exists (
    select 1 from empleos e join profiles pr on pr.empresa_id = e.empresa_id
    where e.id = postulaciones.empleo_id and pr.id = auth.uid()));

drop policy if exists post_emp_update on postulaciones;
create policy post_emp_update on postulaciones for update
  using ((select is_staff()) or exists (
    select 1 from empleos e join profiles pr on pr.empresa_id = e.empresa_id
    where e.id = postulaciones.empleo_id and pr.id = auth.uid()));

drop policy if exists retro_emp on retroalimentacion_empresa;
create policy retro_emp on retroalimentacion_empresa for all
  using ((select is_staff()) or exists (select 1 from postulaciones p join empleos e on e.id = p.empleo_id join profiles pr on pr.empresa_id = e.empresa_id where p.id = retroalimentacion_empresa.postulacion_id and pr.id = auth.uid()))
  with check ((select is_staff()) or exists (select 1 from postulaciones p join empleos e on e.id = p.empleo_id join profiles pr on pr.empresa_id = e.empresa_id where p.id = retroalimentacion_empresa.postulacion_id and pr.id = auth.uid()));

drop policy if exists aten_write on servicio_atenciones;
create policy aten_write on servicio_atenciones for all using ((select is_staff())) with check ((select is_staff()));

drop policy if exists serv_write on servicios;
create policy serv_write on servicios for all using ((select is_staff())) with check ((select is_staff()));

drop policy if exists prac_read on practicas_preprofesionales;
create policy prac_read on practicas_preprofesionales for select
  using ((select is_staff()) or profile_id = auth.uid());

drop policy if exists prac_write on practicas_preprofesionales;
create policy prac_write on practicas_preprofesionales for all using ((select is_staff())) with check ((select is_staff()));

drop policy if exists enc_staff_read on encuestas_respuestas;
create policy enc_staff_read on encuestas_respuestas for select using ((select is_staff()));

drop policy if exists psico_staff_read on psicometria_resultados;
create policy psico_staff_read on psicometria_resultados for select using ((select is_staff()));

drop policy if exists cursosp_read_staff_emp on cursos_persona;
create policy cursosp_read_staff_emp on cursos_persona for select
  using ((select is_staff()) or (select current_rol()) = 'empleador');

drop policy if exists doc_staff_read on documentos_personales;
create policy doc_staff_read on documentos_personales for select using ((select is_staff()));

drop policy if exists doc_staff_delete on documentos_personales;
create policy doc_staff_delete on documentos_personales for delete using ((select is_staff()));

drop policy if exists doc_storage_read on storage.objects;
create policy doc_storage_read on storage.objects for select
  using (
    bucket_id = 'documentos-personales'
    and ((select is_staff()) or (storage.foldername(name))[1] = auth.uid()::text)
  );

drop policy if exists doc_storage_delete on storage.objects;
create policy doc_storage_delete on storage.objects for delete
  using (
    bucket_id = 'documentos-personales'
    and ((select is_staff()) or (storage.foldername(name))[1] = auth.uid()::text)
  );
