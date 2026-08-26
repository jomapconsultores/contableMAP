-- ============================================================
-- RLS — Proyecto Conecta
-- ============================================================

-- Helper: rol del usuario actual
create or replace function current_rol()
returns rol_usuario language sql stable security definer set search_path = public as $$
  select rol from profiles where id = auth.uid();
$$;

create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rol in ('admin','autoridad') from profiles where id = auth.uid()), false);
$$;

-- Habilitar RLS
alter table profiles                 enable row level security;
alter table experiencia_laboral      enable row level security;
alter table educacion                enable row level security;
alter table habilidades              enable row level security;
alter table competencias_graduado    enable row level security;
alter table inscripciones_curso      enable row level security;
alter table cvs                      enable row level security;
alter table empleos                  enable row level security;
alter table empleo_competencias      enable row level security;
alter table postulaciones            enable row level security;
alter table retroalimentacion_empresa enable row level security;
alter table empresas                 enable row level security;
alter table servicios                enable row level security;
alter table servicio_atenciones      enable row level security;
alter table practicas_preprofesionales enable row level security;

-- Catálogos: lectura pública para autenticados
alter table carreras     enable row level security;
alter table competencias enable row level security;
alter table cursos       enable row level security;
alter table graduados_padron enable row level security;

do $$ begin
  -- lectura de catálogos
  create policy cat_read_carreras on carreras for select using (true);
  create policy cat_read_competencias on competencias for select using (true);
  create policy cat_read_cursos on cursos for select using (true);
  create policy cat_read_servicios on servicios for select using (true);
exception when duplicate_object then null; end $$;

-- Padrón: solo staff puede leerlo directamente (el autollenado lo hace el trigger security definer)
do $$ begin
  create policy padron_staff_read on graduados_padron for select using (is_staff());
exception when duplicate_object then null; end $$;

-- PROFILES
do $$ begin
  create policy profiles_read_self on profiles for select
    using (id = auth.uid());
  create policy profiles_read_staff_emp on profiles for select
    using (is_staff() or current_rol() = 'empleador');
  create policy profiles_update_self on profiles for update
    using (id = auth.uid()) with check (id = auth.uid());
exception when duplicate_object then null; end $$;

-- Datos propios del graduado (patrón dueño)
do $$ begin
  create policy exp_owner on experiencia_laboral for all
    using (profile_id = auth.uid()) with check (profile_id = auth.uid());
  create policy exp_read_staff_emp on experiencia_laboral for select
    using (is_staff() or current_rol() = 'empleador');

  create policy edu_owner on educacion for all
    using (profile_id = auth.uid()) with check (profile_id = auth.uid());
  create policy edu_read_staff_emp on educacion for select
    using (is_staff() or current_rol() = 'empleador');

  create policy hab_owner on habilidades for all
    using (profile_id = auth.uid()) with check (profile_id = auth.uid());
  create policy hab_read_staff_emp on habilidades for select
    using (is_staff() or current_rol() = 'empleador');

  create policy compg_owner on competencias_graduado for all
    using (profile_id = auth.uid()) with check (profile_id = auth.uid());
  create policy compg_read_staff_emp on competencias_graduado for select
    using (is_staff() or current_rol() = 'empleador');

  create policy insc_owner on inscripciones_curso for all
    using (profile_id = auth.uid()) with check (profile_id = auth.uid());

  create policy cv_owner on cvs for all
    using (profile_id = auth.uid()) with check (profile_id = auth.uid());
  create policy cv_read_staff_emp on cvs for select
    using (is_staff() or current_rol() = 'empleador');
exception when duplicate_object then null; end $$;

-- EMPRESAS
do $$ begin
  create policy empresas_read on empresas for select using (validada or is_staff());
  create policy empresas_staff_write on empresas for all
    using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

-- EMPLEOS
do $$ begin
  create policy empleos_read_pub on empleos for select
    using (estado = 'publicado' or is_staff()
           or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.empresa_id = empleos.empresa_id));
  create policy empleos_emp_write on empleos for all
    using (exists (select 1 from profiles pr where pr.id = auth.uid() and pr.empresa_id = empleos.empresa_id) or is_staff())
    with check (exists (select 1 from profiles pr where pr.id = auth.uid() and pr.empresa_id = empleos.empresa_id) or is_staff());

  create policy empleocomp_read on empleo_competencias for select using (true);
  create policy empleocomp_write on empleo_competencias for all
    using (is_staff() or exists (
      select 1 from empleos e join profiles pr on pr.empresa_id = e.empresa_id
      where e.id = empleo_competencias.empleo_id and pr.id = auth.uid()))
    with check (is_staff() or exists (
      select 1 from empleos e join profiles pr on pr.empresa_id = e.empresa_id
      where e.id = empleo_competencias.empleo_id and pr.id = auth.uid()));
exception when duplicate_object then null; end $$;

-- POSTULACIONES
do $$ begin
  create policy post_owner on postulaciones for all
    using (profile_id = auth.uid()) with check (profile_id = auth.uid());
  create policy post_emp_read on postulaciones for select
    using (is_staff() or exists (
      select 1 from empleos e join profiles pr on pr.empresa_id = e.empresa_id
      where e.id = postulaciones.empleo_id and pr.id = auth.uid()));
  create policy post_emp_update on postulaciones for update
    using (is_staff() or exists (
      select 1 from empleos e join profiles pr on pr.empresa_id = e.empresa_id
      where e.id = postulaciones.empleo_id and pr.id = auth.uid()));

  create policy retro_emp on retroalimentacion_empresa for all
    using (is_staff() or exists (
      select 1 from postulaciones p join empleos e on e.id = p.empleo_id
      join profiles pr on pr.empresa_id = e.empresa_id
      where p.id = retroalimentacion_empresa.postulacion_id and pr.id = auth.uid()))
    with check (true);
exception when duplicate_object then null; end $$;

-- PILAR 3: servicios / atenciones / prácticas — lectura autenticada, escritura staff
do $$ begin
  create policy aten_read on servicio_atenciones for select using (true);
  create policy aten_write on servicio_atenciones for all using (is_staff()) with check (is_staff());
  create policy serv_write on servicios for all using (is_staff()) with check (is_staff());
  create policy prac_read on practicas_preprofesionales for select
    using (is_staff() or profile_id = auth.uid());
  create policy prac_write on practicas_preprofesionales for all using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;
