-- Otorgar 'autoridad' o 'admin' a alguien concede acceso de staff (o control
-- total). En vez de aplicarse al instante como estudiante/profesional/
-- empleador, queda como solicitud pendiente que el administrador debe
-- aprobar en /admin/solicitudes — una segunda revisión antes de que el
-- privilegio tome efecto. Estudiante/profesional/empleador NO pasan por
-- aquí: no elevan el nivel de acceso de staff, se siguen otorgando al
-- instante (0031_roles_multiples.sql).
create table solicitudes_rol (
  id bigint generated always as identity primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  rol text not null check (rol in ('autoridad', 'admin')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  solicitado_por uuid references profiles(id),
  resuelto_por uuid references profiles(id),
  creado_en timestamptz not null default now(),
  resuelto_en timestamptz
);

-- Evita duplicar una misma solicitud pendiente (ej. dos clics del admin).
create unique index solicitudes_rol_pendiente_unica
  on solicitudes_rol (profile_id, rol)
  where estado = 'pendiente';

create index solicitudes_rol_profile_idx on solicitudes_rol (profile_id);

alter table solicitudes_rol enable row level security;

-- Exclusivo del administrador, igual que roles_asignados_admin_write
-- (0031): "Solo el administrador puede otorgar o revocar roles" aplica
-- también a resolver estas solicitudes.
create policy solicitudes_rol_admin_all on solicitudes_rol
  for all
  using (current_rol() = 'admin')
  with check (current_rol() = 'admin');
