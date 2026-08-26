-- ============================================================
-- 0025 — Publicaciones de la persona (artículos, ponencias, libros)
-- ============================================================
create table if not exists publicaciones_persona (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references profiles(id) on delete cascade,
  titulo      text not null,
  revista     text,
  tipo        text not null default 'articulo'
                check (tipo in ('articulo', 'ponencia', 'libro', 'capitulo_libro', 'otro')),
  fecha       text,
  coautores   text,
  enlace      text,
  fuente      text default 'manual',
  created_at  timestamptz not null default now()
);

create index if not exists idx_publicaciones_persona_profile on publicaciones_persona (profile_id);

alter table publicaciones_persona enable row level security;

drop policy if exists public_owner on publicaciones_persona;
create policy public_owner on publicaciones_persona for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists public_read_staff_emp on publicaciones_persona;
create policy public_read_staff_emp on publicaciones_persona for select
  using ((select is_staff()) or (select current_rol()) = 'empleador');
