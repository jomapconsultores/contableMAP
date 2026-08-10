-- =====================================================================
-- ContableMAP · 0002 · Motor contable de partida doble
-- Asientos, líneas, validación de cuadre, libro mayor y balance de sumas
-- y saldos (base de P&G y Balance General).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Períodos contables: impiden registrar sobre un mes ya cerrado
-- ---------------------------------------------------------------------
create table if not exists public.periodos (
  id          uuid primary key default gen_random_uuid(),
  entidad_id  uuid not null references public.entidades(id) on delete cascade,
  anio        int not null,
  mes         int not null check (mes between 1 and 12),
  estado      text not null default 'ABIERTO' check (estado in ('ABIERTO','CERRADO')),
  cerrado_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (entidad_id, anio, mes)
);

-- ---------------------------------------------------------------------
-- Asiento contable
-- ---------------------------------------------------------------------
create table if not exists public.asientos (
  id           uuid primary key default gen_random_uuid(),
  entidad_id   uuid not null references public.entidades(id) on delete cascade,
  fecha        date not null,
  numero       bigint,
  tipo         text not null default 'DIARIO'
                 check (tipo in ('APERTURA','DIARIO','INGRESO','EGRESO','AJUSTE','CIERRE')),
  glosa        text not null,
  -- Trazabilidad: de dónde salió el asiento
  origen       text not null default 'MANUAL'
                 check (origen in ('MANUAL','VOZ','DOCUMENTO','COMPRA','VENTA','ROL_PAGO',
                                   'EXTRACTO','COBRO','PAGO','IMPUESTO','CIERRE')),
  origen_id    uuid,
  estado       text not null default 'BORRADOR'
                 check (estado in ('BORRADOR','CONTABILIZADO','ANULADO')),
  -- Confianza de la IA cuando el asiento fue propuesto automáticamente
  confianza_ia numeric(4,3),
  revisado     boolean not null default false,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_asientos_entidad_fecha on public.asientos(entidad_id, fecha);
create index if not exists idx_asientos_origen        on public.asientos(origen, origen_id);
create index if not exists idx_asientos_estado        on public.asientos(entidad_id, estado);

-- ---------------------------------------------------------------------
-- Líneas del asiento
-- ---------------------------------------------------------------------
create table if not exists public.asiento_lineas (
  id         uuid primary key default gen_random_uuid(),
  asiento_id uuid not null references public.asientos(id) on delete cascade,
  orden      int not null default 1,
  cuenta_id  uuid not null references public.plan_cuentas(id) on delete restrict,
  tercero_id uuid references public.terceros(id) on delete set null,
  detalle    text,
  debe       numeric(16,2) not null default 0 check (debe  >= 0),
  haber      numeric(16,2) not null default 0 check (haber >= 0),
  -- Una línea es débito o crédito, nunca ambos ni ninguno
  constraint chk_debe_o_haber check ((debe > 0 and haber = 0) or (haber > 0 and debe = 0))
);

create index if not exists idx_lineas_asiento on public.asiento_lineas(asiento_id);
create index if not exists idx_lineas_cuenta  on public.asiento_lineas(cuenta_id);

-- ---------------------------------------------------------------------
-- Numeración correlativa por entidad y año
-- ---------------------------------------------------------------------
create or replace function public.tg_asiento_numero()
returns trigger language plpgsql as $$
begin
  if new.numero is null then
    select coalesce(max(a.numero), 0) + 1 into new.numero
      from public.asientos a
     where a.entidad_id = new.entidad_id
       and extract(year from a.fecha) = extract(year from new.fecha);
  end if;
  return new;
end $$;

drop trigger if exists set_asiento_numero on public.asientos;
create trigger set_asiento_numero before insert on public.asientos
for each row execute function public.tg_asiento_numero();

drop trigger if exists set_updated_at on public.asientos;
create trigger set_updated_at before update on public.asientos
for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Validaciones de integridad contable
-- ---------------------------------------------------------------------

-- La cuenta debe pertenecer a la misma entidad y ser de movimiento.
create or replace function public.tg_valida_linea()
returns trigger language plpgsql as $$
declare
  v_entidad_asiento uuid;
  v_entidad_cuenta  uuid;
  v_es_movimiento   boolean;
begin
  select entidad_id into v_entidad_asiento from public.asientos where id = new.asiento_id;
  select entidad_id, es_movimiento into v_entidad_cuenta, v_es_movimiento
    from public.plan_cuentas where id = new.cuenta_id;

  if v_entidad_asiento is distinct from v_entidad_cuenta then
    raise exception 'La cuenta % no pertenece a la entidad del asiento', new.cuenta_id;
  end if;

  if not v_es_movimiento then
    raise exception 'La cuenta % es de agrupación y no admite movimientos', new.cuenta_id;
  end if;

  return new;
end $$;

drop trigger if exists valida_linea on public.asiento_lineas;
create trigger valida_linea before insert or update on public.asiento_lineas
for each row execute function public.tg_valida_linea();

-- Un asiento CONTABILIZADO debe cuadrar y caer en un período abierto.
create or replace function public.tg_valida_asiento_contabilizado()
returns trigger language plpgsql as $$
declare
  v_debe   numeric(16,2);
  v_haber  numeric(16,2);
  v_lineas int;
  v_estado text;
begin
  if new.estado <> 'CONTABILIZADO' then
    return new;
  end if;

  select coalesce(sum(debe),0), coalesce(sum(haber),0), count(*)
    into v_debe, v_haber, v_lineas
    from public.asiento_lineas where asiento_id = new.id;

  if v_lineas < 2 then
    raise exception 'El asiento % requiere al menos dos líneas', new.id;
  end if;

  if v_debe <> v_haber then
    raise exception 'Asiento descuadrado: debe % <> haber %', v_debe, v_haber;
  end if;

  select estado into v_estado
    from public.periodos
   where entidad_id = new.entidad_id
     and anio = extract(year from new.fecha)::int
     and mes  = extract(month from new.fecha)::int;

  if v_estado = 'CERRADO' then
    raise exception 'El período % ya está cerrado', to_char(new.fecha, 'YYYY-MM');
  end if;

  return new;
end $$;

drop trigger if exists valida_asiento on public.asientos;
create trigger valida_asiento before update on public.asientos
for each row execute function public.tg_valida_asiento_contabilizado();

-- ---------------------------------------------------------------------
-- Libro mayor: una fila por movimiento contabilizado
-- ---------------------------------------------------------------------
-- security_invoker: sin esto la vista se ejecuta con los permisos del
-- propietario y saltaría el RLS de las tablas base.
create or replace view public.v_libro_mayor
with (security_invoker = true) as
select
  a.entidad_id,
  a.id            as asiento_id,
  a.fecha,
  a.numero,
  a.tipo,
  a.glosa,
  l.id            as linea_id,
  l.orden,
  c.id            as cuenta_id,
  c.codigo,
  c.nombre        as cuenta,
  c.tipo          as tipo_cuenta,
  c.naturaleza,
  l.detalle,
  l.tercero_id,
  l.debe,
  l.haber,
  case when c.naturaleza = 'D' then l.debe - l.haber else l.haber - l.debe end as movimiento
from public.asientos a
join public.asiento_lineas l on l.asiento_id = a.id
join public.plan_cuentas   c on c.id = l.cuenta_id
where a.estado = 'CONTABILIZADO';

-- ---------------------------------------------------------------------
-- Balance de sumas y saldos para un rango de fechas.
-- Es la fuente única de la que se derivan P&G y Balance General.
-- ---------------------------------------------------------------------
create or replace function public.fn_balance_saldos(
  p_entidad uuid,
  p_desde   date,
  p_hasta   date
)
returns table (
  cuenta_id   uuid,
  codigo      text,
  cuenta      text,
  tipo        text,
  subtipo     text,
  naturaleza  char(1),
  saldo_inicial numeric(16,2),
  debe        numeric(16,2),
  haber       numeric(16,2),
  saldo_final numeric(16,2)
)
language sql stable as $$
  with cuentas as (
    select id, codigo, nombre, tipo, subtipo, naturaleza
      from public.plan_cuentas
     where entidad_id = p_entidad and es_movimiento
  ),
  -- Los saldos iniciales solo aplican a cuentas de balance; las cuentas de
  -- resultado (ingreso/costo/gasto) arrancan en cero cada período consultado.
  inicial as (
    select m.cuenta_id,
           sum(case when c.naturaleza = 'D' then m.debe - m.haber
                    else m.haber - m.debe end) as saldo
      from public.v_libro_mayor m
      join cuentas c on c.id = m.cuenta_id
     where m.entidad_id = p_entidad
       and m.fecha < p_desde
       and c.tipo in ('ACTIVO','PASIVO','PATRIMONIO')
     group by m.cuenta_id
  ),
  periodo as (
    select m.cuenta_id,
           sum(m.debe)  as debe,
           sum(m.haber) as haber
      from public.v_libro_mayor m
     where m.entidad_id = p_entidad
       and m.fecha between p_desde and p_hasta
     group by m.cuenta_id
  )
  select
    c.id,
    c.codigo,
    c.nombre,
    c.tipo,
    c.subtipo,
    c.naturaleza,
    coalesce(i.saldo, 0)::numeric(16,2),
    coalesce(p.debe, 0)::numeric(16,2),
    coalesce(p.haber, 0)::numeric(16,2),
    (coalesce(i.saldo, 0)
      + case when c.naturaleza = 'D'
             then coalesce(p.debe,0) - coalesce(p.haber,0)
             else coalesce(p.haber,0) - coalesce(p.debe,0) end)::numeric(16,2)
  from cuentas c
  left join inicial i on i.cuenta_id = c.id
  left join periodo p on p.cuenta_id = c.id
  where coalesce(i.saldo,0) <> 0 or coalesce(p.debe,0) <> 0 or coalesce(p.haber,0) <> 0
  order by c.codigo;
$$;
