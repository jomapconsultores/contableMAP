-- api/auth/login y api/diagnostico ya escribían en "debug_eventos" (bitácora
-- de diagnóstico, nunca guarda contraseñas), pero la tabla nunca se creó en
-- una migración versionada: en cualquier entorno nuevo (local o de
-- despliegue) el insert fallaba silenciosamente en cada intento de login.
create table if not exists debug_eventos (
  id         bigint generated always as identity primary key,
  tipo       text not null,
  datos      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Solo se escribe/lee vía service role desde rutas del servidor; sin
-- políticas de owner/anon.
alter table debug_eventos enable row level security;
