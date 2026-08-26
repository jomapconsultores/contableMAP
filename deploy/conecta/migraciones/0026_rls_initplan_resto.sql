-- ============================================================
-- 0026 — Rendimiento: resto de auth_rls_initplan + índices de FK faltantes
-- ============================================================
-- 0018_rls_initplan_e_indices.sql envolvió is_staff()/current_rol() en
-- (select ...) para la mayoría de políticas, pero dejó sin envolver:
--   a) las políticas *_owner "for all" (profile_id = auth.uid()), que nunca
--      pasaron por 0018 porque 0018 solo tocó las variantes *_read_staff.
--   b) profiles_read_self / profiles_update_self (id = auth.uid()).
--   c) las llamadas "sueltas" a auth.uid() DENTRO de un EXISTS(...)
--      correlacionado (empleos_read_pub, empleos_emp_write, empleocomp_write,
--      post_emp_read, post_emp_update, retro_emp, prac_read): el comentario de
--      0018 asumía que un EXISTS correlacionado no se beneficia de (select
--      ...), pero eso solo es cierto para las columnas de correlación
--      (empresa_id, empleo_id, etc.) — auth.uid() en sí no depende de la fila
--      externa y sí se recalcula una vez por fila si no se envuelve, aunque
--      esté dentro del EXISTS. Envolverlo permite que el planner lo trate
--      como InitPlan (se resuelve una sola vez) incluso si el EXISTS igual se
--      ejecuta por fila por las demás condiciones correlacionadas.
--
-- Ninguna condición de negocio cambia: (select auth.uid()) es exactamente
-- equivalente a auth.uid() en cualquier posición (auth.uid() es STABLE y
-- constante dentro de una misma consulta), solo cambia cómo lo evalúa el
-- planner.
--
-- NOTA (fuera de alcance de este archivo, ver hallazgo de auditoría):
--   - La política "psico_owner" en psicometria_resultados existe en la base
--     viva como FOR ALL (profile_id = auth.uid()), pero NINGUNA migración la
--     creó así: 0009_psicometria.sql creó "psico_owner_read" (solo SELECT) y
--     "psico_owner_insert" (solo INSERT con check), documentando
--     explícitamente que el dueño NO debe poder actualizar/borrar su propio
--     resultado psicométrico (para que no pueda alterar o eliminar una alerta
--     de riesgo psicosocial ya registrada). En algún momento, fuera de una
--     migración versionada, alguien reemplazó esas dos políticas por una sola
--     "psico_owner" FOR ALL, reabriendo esa puerta. Esta migración SOLO envuelve
--     auth.uid() para rendimiento y preserva el comportamiento actual (FOR ALL)
--     tal como exige el alcance de esta tarea; la corrección de ese hallazgo de
--     seguridad (volver a psico_owner_read/psico_owner_insert sin update/delete)
--     debe hacerse aparte, a propósito, porque SÍ cambia el comportamiento.
--   - La función "es_postulante_de_mi_empresa(uuid)" (usada por
--     compg_read_emp, cv_read_emp, edu_read_emp, exp_read_emp, hab_read_emp,
--     profiles_read_emp_postulantes) tampoco existe en ninguna migración:
--     está viva en la base pero no versionada. No se toca aquí (no está en la
--     lista de auth_rls_initplan — su parámetro varía por fila, así que no
--     aplica el mismo fix), pero conviene versionarla en una migración aparte
--     para que un entorno nuevo no falle al crear esas políticas.
-- ============================================================

-- --- profiles ---
drop policy if exists profiles_read_self on profiles;
create policy profiles_read_self on profiles for select
  using (id = (select auth.uid()));

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- --- *_owner (patrón dueño, sin exists) ---
drop policy if exists exp_owner on experiencia_laboral;
create policy exp_owner on experiencia_laboral for all
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists edu_owner on educacion;
create policy edu_owner on educacion for all
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists hab_owner on habilidades;
create policy hab_owner on habilidades for all
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists compg_owner on competencias_graduado;
create policy compg_owner on competencias_graduado for all
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists insc_owner on inscripciones_curso;
create policy insc_owner on inscripciones_curso for all
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists cv_owner on cvs;
create policy cv_owner on cvs for all
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists post_owner on postulaciones;
create policy post_owner on postulaciones for all
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists enc_owner on encuestas_respuestas;
create policy enc_owner on encuestas_respuestas for all
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

-- Preserva el comportamiento actual (FOR ALL) de psico_owner tal cual está
-- en la base viva: no se restringe a solo SELECT/INSERT aquí (ver nota arriba).
drop policy if exists psico_owner on psicometria_resultados;
create policy psico_owner on psicometria_resultados for all
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists cursosp_owner on cursos_persona;
create policy cursosp_owner on cursos_persona for all
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists doc_owner on documentos_personales;
create policy doc_owner on documentos_personales for all
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists public_owner on publicaciones_persona;
create policy public_owner on publicaciones_persona for all
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

-- --- políticas con EXISTS(...) correlacionado: se envuelve solo auth.uid(),
-- las columnas de correlación (empresa_id, empleo_id, etc.) siguen igual ---
drop policy if exists empleos_read_pub on empleos;
create policy empleos_read_pub on empleos for select
  using (estado = 'publicado' or (select is_staff())
         or exists (select 1 from profiles pr where pr.id = (select auth.uid()) and pr.empresa_id = empleos.empresa_id));

drop policy if exists empleos_emp_write on empleos;
create policy empleos_emp_write on empleos for all
  using (exists (select 1 from profiles pr where pr.id = (select auth.uid()) and pr.empresa_id = empleos.empresa_id) or (select is_staff()))
  with check (exists (select 1 from profiles pr where pr.id = (select auth.uid()) and pr.empresa_id = empleos.empresa_id) or (select is_staff()));

drop policy if exists empleocomp_write on empleo_competencias;
create policy empleocomp_write on empleo_competencias for all
  using ((select is_staff()) or exists (
    select 1 from empleos e join profiles pr on pr.empresa_id = e.empresa_id
    where e.id = empleo_competencias.empleo_id and pr.id = (select auth.uid())))
  with check ((select is_staff()) or exists (
    select 1 from empleos e join profiles pr on pr.empresa_id = e.empresa_id
    where e.id = empleo_competencias.empleo_id and pr.id = (select auth.uid())));

drop policy if exists post_emp_read on postulaciones;
create policy post_emp_read on postulaciones for select
  using ((select is_staff()) or exists (
    select 1 from empleos e join profiles pr on pr.empresa_id = e.empresa_id
    where e.id = postulaciones.empleo_id and pr.id = (select auth.uid())));

drop policy if exists post_emp_update on postulaciones;
create policy post_emp_update on postulaciones for update
  using ((select is_staff()) or exists (
    select 1 from empleos e join profiles pr on pr.empresa_id = e.empresa_id
    where e.id = postulaciones.empleo_id and pr.id = (select auth.uid())));

drop policy if exists retro_emp on retroalimentacion_empresa;
create policy retro_emp on retroalimentacion_empresa for all
  using ((select is_staff()) or exists (
    select 1 from postulaciones p join empleos e on e.id = p.empleo_id join profiles pr on pr.empresa_id = e.empresa_id
    where p.id = retroalimentacion_empresa.postulacion_id and pr.id = (select auth.uid())))
  with check ((select is_staff()) or exists (
    select 1 from postulaciones p join empleos e on e.id = p.empleo_id join profiles pr on pr.empresa_id = e.empresa_id
    where p.id = retroalimentacion_empresa.postulacion_id and pr.id = (select auth.uid())));

drop policy if exists prac_read on practicas_preprofesionales;
create policy prac_read on practicas_preprofesionales for select
  using ((select is_staff()) or profile_id = (select auth.uid()));

-- ============================================================
-- Índices de FK sin cubrir (unindexed_foreign_keys) — 14 columnas
-- ============================================================
create index if not exists idx_competencias_graduado_competencia on competencias_graduado(competencia_id);
create index if not exists idx_competencias_graduado_curso on competencias_graduado(curso_id);
create index if not exists idx_cursos_competencia on cursos(competencia_id);
create index if not exists idx_documentos_personales_subido_por on documentos_personales(subido_por);
create index if not exists idx_empleo_competencias_competencia on empleo_competencias(competencia_id);
create index if not exists idx_empleos_empresa on empleos(empresa_id);
create index if not exists idx_empleos_created_by on empleos(created_by);
create index if not exists idx_encuestas_respuestas_profile on encuestas_respuestas(profile_id);
create index if not exists idx_graduados_padron_carrera on graduados_padron(carrera_id);
create index if not exists idx_inscripciones_curso_curso on inscripciones_curso(curso_id);
create index if not exists idx_practicas_preprofesionales_servicio on practicas_preprofesionales(servicio_id);
create index if not exists idx_profiles_carrera on profiles(carrera_id);
create index if not exists idx_profiles_empresa on profiles(empresa_id);
create index if not exists idx_retroalimentacion_empresa_postulacion on retroalimentacion_empresa(postulacion_id);
