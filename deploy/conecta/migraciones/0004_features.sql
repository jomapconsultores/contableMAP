-- ============================================================
-- 0004 — Certificados verificables, encuestas y analítica
-- ============================================================

-- Certificados verificables: código único por competencia avalada
alter table competencias_graduado add column if not exists codigo_verificacion text unique;

update competencias_graduado
set codigo_verificacion = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
where estado = 'avalada' and codigo_verificacion is null;

-- ------------------------------------------------------------
-- ENCUESTAS (pertinencia de la formación / satisfacción de empleadores)
-- ------------------------------------------------------------
create table if not exists encuestas_respuestas (
  id          bigint generated always as identity primary key,
  profile_id  uuid references profiles(id) on delete cascade,
  tipo        text not null,               -- 'pertinencia' | 'satisfaccion_empleador'
  respuestas  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

alter table encuestas_respuestas enable row level security;

do $$ begin
  create policy enc_owner on encuestas_respuestas for all
    using (profile_id = auth.uid()) with check (profile_id = auth.uid());
  create policy enc_staff_read on encuestas_respuestas for select using (is_staff());
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- VISTA: empleabilidad por carrera (Pilar 4)
-- ------------------------------------------------------------
create or replace view v_empleabilidad_carrera as
with grads as (
  select p.id, p.carrera_id from profiles p where p.rol = 'graduado'
)
select
  c.id,
  c.nombre as carrera,
  c.facultad,
  (select count(*) from grads g where g.carrera_id = c.id) as graduados,
  (select count(distinct po.profile_id) from postulaciones po
     join grads g on g.id = po.profile_id where g.carrera_id = c.id) as postulantes,
  (select count(distinct po.profile_id) from postulaciones po
     join grads g on g.id = po.profile_id where g.carrera_id = c.id and po.estado = 'contratado') as contratados,
  (select count(*) from competencias_graduado cg
     join grads g on g.id = cg.profile_id where g.carrera_id = c.id and cg.estado = 'avalada') as competencias_avaladas
from carreras c
order by c.nombre;

-- ------------------------------------------------------------
-- VISTA: brechas de competencias más frecuentes
-- (competencias requeridas por empleos que los graduados NO tienen avaladas)
-- ------------------------------------------------------------
create or replace view v_brechas_competencias as
select
  co.id,
  co.nombre as competencia,
  co.area,
  count(distinct ec.empleo_id) as empleos_que_la_piden,
  count(distinct cg.profile_id) filter (where cg.estado = 'avalada') as graduados_con_aval
from competencias co
left join empleo_competencias ec on ec.competencia_id = co.id and ec.requerida
left join competencias_graduado cg on cg.competencia_id = co.id
group by co.id
having count(distinct ec.empleo_id) > 0
order by empleos_que_la_piden desc;
