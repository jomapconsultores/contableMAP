-- =====================================================================
-- ContableMAP · 0005 · Cartera y crédito tributario
-- Cuentas y documentos por cobrar / por pagar, abonos y el mayor de
-- crédito tributario (IVA y Renta).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Cartera: cuentas y documentos por cobrar / pagar
--   CXC / CXP          → cuentas (facturas a crédito)
--   DOC_COBRAR / DOC_PAGAR → documentos (letras, pagarés, préstamos)
-- ---------------------------------------------------------------------
create table if not exists public.cartera (
  id                 uuid primary key default gen_random_uuid(),
  entidad_id         uuid not null references public.entidades(id) on delete cascade,
  clase              text not null
                       check (clase in ('CXC','CXP','DOC_COBRAR','DOC_PAGAR')),
  tercero_id         uuid references public.terceros(id) on delete set null,
  nombre_tercero     text not null,
  identificacion     text,

  descripcion        text not null,
  referencia         text,               -- nº de factura, letra o pagaré
  fecha_emision      date not null,
  fecha_vencimiento  date not null,

  monto_original     numeric(16,2) not null check (monto_original > 0),
  -- Saldo pendiente, recalculado por trigger a partir de los abonos
  saldo              numeric(16,2) not null default 0,
  moneda             char(3) not null default 'USD',
  tasa_interes       numeric(8,4) not null default 0,

  -- Origen del documento
  compra_id          uuid references public.compras(id) on delete set null,
  venta_id           uuid references public.ventas(id) on delete set null,
  cuenta_id          uuid references public.plan_cuentas(id) on delete set null,
  asiento_id         uuid references public.asientos(id) on delete set null,

  estado             text not null default 'PENDIENTE'
                       check (estado in ('PENDIENTE','PARCIAL','CANCELADO','INCOBRABLE','ANULADO')),
  notas              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_cartera_entidad on public.cartera(entidad_id, clase, estado);
create index if not exists idx_cartera_venc    on public.cartera(entidad_id, fecha_vencimiento)
  where estado in ('PENDIENTE','PARCIAL');

-- ---------------------------------------------------------------------
-- Abonos (cobros y pagos) aplicados a la cartera
-- ---------------------------------------------------------------------
create table if not exists public.abonos (
  id                   uuid primary key default gen_random_uuid(),
  entidad_id           uuid not null references public.entidades(id) on delete cascade,
  cartera_id           uuid not null references public.cartera(id) on delete cascade,
  fecha                date not null,
  monto                numeric(16,2) not null check (monto > 0),
  interes              numeric(16,2) not null default 0,
  cuenta_financiera_id uuid references public.cuentas_financieras(id) on delete set null,
  forma_pago           text,
  referencia           text,
  asiento_id           uuid references public.asientos(id) on delete set null,
  notas                text,
  created_at           timestamptz not null default now()
);

create index if not exists idx_abonos_cartera on public.abonos(cartera_id, fecha);

-- ---------------------------------------------------------------------
-- El saldo de cartera siempre se deriva de los abonos registrados
-- ---------------------------------------------------------------------
create or replace function public.tg_recalcula_saldo_cartera()
returns trigger language plpgsql as $$
declare
  v_cartera uuid := coalesce(new.cartera_id, old.cartera_id);
  v_original numeric(16,2);
  v_abonado  numeric(16,2);
  v_saldo    numeric(16,2);
begin
  select monto_original into v_original from public.cartera where id = v_cartera;
  select coalesce(sum(monto), 0) into v_abonado from public.abonos where cartera_id = v_cartera;

  v_saldo := round(v_original - v_abonado, 2);

  if v_saldo < 0 then
    raise exception 'Los abonos (%) exceden el monto del documento (%)', v_abonado, v_original;
  end if;

  update public.cartera
     set saldo  = v_saldo,
         estado = case
                    when estado in ('ANULADO','INCOBRABLE') then estado
                    when v_saldo = 0            then 'CANCELADO'
                    when v_abonado > 0          then 'PARCIAL'
                    else 'PENDIENTE'
                  end,
         updated_at = now()
   where id = v_cartera;

  return null;
end $$;

drop trigger if exists recalcula_saldo on public.abonos;
create trigger recalcula_saldo after insert or update or delete on public.abonos
for each row execute function public.tg_recalcula_saldo_cartera();

-- Al crear el documento, el saldo arranca igual al monto original
create or replace function public.tg_saldo_inicial_cartera()
returns trigger language plpgsql as $$
begin
  if new.saldo = 0 and new.estado = 'PENDIENTE' then
    new.saldo := new.monto_original;
  end if;
  return new;
end $$;

drop trigger if exists saldo_inicial on public.cartera;
create trigger saldo_inicial before insert on public.cartera
for each row execute function public.tg_saldo_inicial_cartera();

drop trigger if exists set_updated_at on public.cartera;
create trigger set_updated_at before update on public.cartera
for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Mayor de crédito tributario: IVA y Renta.
-- Cada fila es un movimiento; el saldo se obtiene acumulando.
-- ---------------------------------------------------------------------
create table if not exists public.credito_tributario (
  id            uuid primary key default gen_random_uuid(),
  entidad_id    uuid not null references public.entidades(id) on delete cascade,
  impuesto      text not null check (impuesto in ('IVA','RENTA')),
  anio          int not null,
  mes           int check (mes between 1 and 12),
  fecha         date not null,
  -- ORIGEN: se genera crédito · APLICACION: se consume contra el impuesto causado
  tipo          text not null
                  check (tipo in ('ADQUISICIONES','RETENCION_RECIBIDA','SALDO_ANTERIOR',
                                  'APLICACION','DEVOLUCION','AJUSTE')),
  concepto      text not null,
  -- Positivo genera crédito, negativo lo consume
  monto         numeric(16,2) not null,
  declaracion_id uuid,
  referencia_id uuid,
  notas         text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_credito_entidad on public.credito_tributario(entidad_id, impuesto, anio, mes);

-- Saldo de crédito tributario acumulado hasta un período
create or replace function public.fn_saldo_credito_tributario(
  p_entidad  uuid,
  p_impuesto text,
  p_anio     int,
  p_mes      int default 12
)
returns numeric
language sql stable as $$
  select coalesce(sum(monto), 0)::numeric(16,2)
    from public.credito_tributario
   where entidad_id = p_entidad
     and impuesto   = p_impuesto
     and (anio < p_anio or (anio = p_anio and coalesce(mes, 12) <= p_mes));
$$;

-- ---------------------------------------------------------------------
-- Vista de antigüedad de cartera
-- ---------------------------------------------------------------------
create or replace view public.v_cartera_antiguedad
with (security_invoker = true) as
select
  c.*,
  (current_date - c.fecha_vencimiento) as dias_vencido,
  case
    when c.estado in ('CANCELADO','ANULADO')         then 'CANCELADO'
    when current_date <= c.fecha_vencimiento         then 'POR_VENCER'
    when current_date - c.fecha_vencimiento <= 30    then '1_30'
    when current_date - c.fecha_vencimiento <= 60    then '31_60'
    when current_date - c.fecha_vencimiento <= 90    then '61_90'
    else 'MAS_90'
  end as rango
from public.cartera c;
