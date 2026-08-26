-- ============================================================
-- 0009 — Evaluación psicométrica voluntaria (Perfil Psicolaboral)
-- ============================================================
-- Prueba de autoaplicación, voluntaria, para graduados/estudiantes/profesionales.
-- Contenido del instrumento y cálculo de puntajes en src/lib/psicometria.ts.
-- Visibilidad: la propia persona (dueña) y el staff (admin/autoridad) vía is_staff().
-- Ningún empleador ni otro graduado puede leer esta tabla.

create table if not exists psicometria_resultados (
  id             bigint generated always as identity primary key,
  profile_id     uuid not null references profiles(id) on delete cascade,
  tipo           text not null default 'perfil_psicolaboral',
  respuestas     jsonb not null default '{}'::jsonb,
  puntuaciones   jsonb not null default '{}'::jsonb,
  interpretacion jsonb not null default '{}'::jsonb,
  alerta         boolean not null default false,
  created_at     timestamptz not null default now()
);

alter table psicometria_resultados enable row level security;

create index if not exists idx_psico_profile on psicometria_resultados(profile_id, created_at desc);

drop policy if exists psico_owner on psicometria_resultados;
drop policy if exists psico_owner_read on psicometria_resultados;
drop policy if exists psico_owner_insert on psicometria_resultados;
drop policy if exists psico_staff_read on psicometria_resultados;
-- Sin update/delete para la persona dueña: una vez registrado, el resultado (y su alerta de
-- riesgo psicosocial) no puede ser modificado ni borrado por quien lo rindió.
create policy psico_owner_read on psicometria_resultados for select using (profile_id = auth.uid());
create policy psico_owner_insert on psicometria_resultados for insert with check (profile_id = auth.uid());
create policy psico_staff_read on psicometria_resultados for select using (is_staff());
