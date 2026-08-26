-- Documenta en el repo la función y las 6 políticas que ya corren en
-- producción (aplicadas directamente, fuera de cualquier migración
-- versionada), que reemplazaron los EXISTS(...) inline de 0008/0018 por esta
-- función compartida. Lógicamente equivalente a esos EXISTS; se versiona
-- solo para que una base nueva (CI, `supabase db reset`) no falle al crear
-- estas políticas por referenciar una función inexistente.
create or replace function es_postulante_de_mi_empresa(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from postulaciones po
    join empleos e on e.id = po.empleo_id
    join profiles emp on emp.id = auth.uid()
    where po.profile_id = p_profile
      and emp.rol = 'empleador'
      and emp.empresa_id is not null
      and e.empresa_id = emp.empresa_id
  );
$$;

drop policy if exists compg_read_emp on competencias_graduado;
create policy compg_read_emp on competencias_graduado for select
  using (es_postulante_de_mi_empresa(profile_id));

drop policy if exists cv_read_emp on cvs;
create policy cv_read_emp on cvs for select
  using (es_postulante_de_mi_empresa(profile_id));

drop policy if exists edu_read_emp on educacion;
create policy edu_read_emp on educacion for select
  using (es_postulante_de_mi_empresa(profile_id));

drop policy if exists exp_read_emp on experiencia_laboral;
create policy exp_read_emp on experiencia_laboral for select
  using (es_postulante_de_mi_empresa(profile_id));

drop policy if exists hab_read_emp on habilidades;
create policy hab_read_emp on habilidades for select
  using (es_postulante_de_mi_empresa(profile_id));

drop policy if exists profiles_read_emp_postulantes on profiles;
create policy profiles_read_emp_postulantes on profiles for select
  using (es_postulante_de_mi_empresa(id));
