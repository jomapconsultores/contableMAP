-- ============================================================
-- 0010 — Cursos/capacitaciones de la persona (apartado separado de títulos)
-- Alimentado desde SENESCYT (registros que no son títulos de grado).
-- ============================================================

create table if not exists cursos_persona (
  id              bigint generated always as identity primary key,
  profile_id      uuid not null references profiles(id) on delete cascade,
  nombre          text not null,
  institucion     text,
  fecha           text,
  area_nombre     text,
  numero_registro text,
  fuente          text default 'senescyt',
  created_at      timestamptz not null default now()
);

create index if not exists idx_cursos_persona_profile on cursos_persona (profile_id);

alter table cursos_persona enable row level security;

do $$ begin
  create policy cursosp_owner on cursos_persona for all
    using (profile_id = auth.uid()) with check (profile_id = auth.uid());
  create policy cursosp_read_staff_emp on cursos_persona for select
    using (is_staff() or current_rol() = 'empleador');
exception when duplicate_object then null; end $$;
