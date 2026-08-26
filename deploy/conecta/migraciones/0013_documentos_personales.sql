-- ============================================================
-- 0013 — Repositorio de documentos personales
-- ============================================================
-- Cada estudiante/profesional tiene su propio repositorio de documentos
-- (cédula, título, certificados, etc.), privado por defecto: ningún otro
-- usuario (ni siquiera un empleador con el que haya postulaciones) puede
-- verlo. Solo el dueño y el staff real (admin, o autoridad aprobada, ver
-- is_staff() en 0005_niveles.sql) tienen acceso — igual que el resto de
-- datos de identidad, pero SIN la excepción de "empleador" que sí aplica
-- a cvs/experiencia/educación.

create table if not exists documentos_personales (
  id              bigint generated always as identity primary key,
  profile_id      uuid not null references profiles(id) on delete cascade,
  categoria       text not null default 'otro'
                    check (categoria in ('cedula','titulo','certificado','cv','contrato','otro')),
  nombre_original text not null,
  storage_path    text not null unique,
  mime_type       text,
  tamano_bytes    bigint,
  subido_por      uuid references profiles(id),
  created_at      timestamptz not null default now()
);

create index if not exists documentos_personales_profile_idx on documentos_personales(profile_id);

alter table documentos_personales enable row level security;

drop policy if exists doc_owner on documentos_personales;
create policy doc_owner on documentos_personales for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists doc_staff_read on documentos_personales;
create policy doc_staff_read on documentos_personales for select using (is_staff());

drop policy if exists doc_staff_delete on documentos_personales;
create policy doc_staff_delete on documentos_personales for delete using (is_staff());

-- ------------------------------------------------------------
-- Storage: bucket privado, un folder por persona (profile_id/…)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documentos-personales', 'documentos-personales', false)
on conflict (id) do nothing;

drop policy if exists doc_storage_read on storage.objects;
create policy doc_storage_read on storage.objects for select
  using (
    bucket_id = 'documentos-personales'
    and (is_staff() or (storage.foldername(name))[1] = auth.uid()::text)
  );

drop policy if exists doc_storage_insert on storage.objects;
create policy doc_storage_insert on storage.objects for insert
  with check (
    bucket_id = 'documentos-personales'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists doc_storage_delete on storage.objects;
create policy doc_storage_delete on storage.objects for delete
  using (
    bucket_id = 'documentos-personales'
    and (is_staff() or (storage.foldername(name))[1] = auth.uid()::text)
  );
