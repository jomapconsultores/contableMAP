-- ---------------------------------------------------------------------
-- Recobro de gastos a terceros
--
-- Hay gastos que Marco paga con su tarjeta pero que corresponden a otra
-- empresa —suscripciones de software de CMAJ, por ejemplo— y que luego le
-- factura. Hasta ahora no quedaba constancia de cuáles se habían recobrado
-- ya, y el único rastro era una factura de «servicios profesionales» sin
-- desglose: al preparar el recobro de junio de 2026 hubo que deducir a mano
-- si una factura anterior lo cubría, y la deducción salió mal.
--
-- Dos columnas lo resuelven:
--   · `recobro_tercero_id` marca que el gasto es recobrable y a quién.
--   · `recobro_venta_id` marca con qué factura se recobró.
--
-- Un movimiento solo puede apuntar a una venta, así que la propia columna
-- impide facturarlo dos veces. Lo pendiente de recobrar es lo que tiene
-- tercero pero todavía no tiene venta.
-- ---------------------------------------------------------------------

alter table public.movimientos_extracto
  add column if not exists recobro_tercero_id uuid
    references public.terceros(id) on delete set null,
  add column if not exists recobro_venta_id uuid
    references public.ventas(id) on delete set null;

comment on column public.movimientos_extracto.recobro_tercero_id is
  'Tercero al que se le debe recobrar este gasto. Null = no es recobrable.';
comment on column public.movimientos_extracto.recobro_venta_id is
  'Venta con la que se recobró. Null = pendiente. Fijado, no volver a facturarlo.';

-- No se puede marcar como recobrado sin decir a quién se recobra.
alter table public.movimientos_extracto
  drop constraint if exists chk_recobro_coherente;
alter table public.movimientos_extracto
  add constraint chk_recobro_coherente
  check (recobro_venta_id is null or recobro_tercero_id is not null);

-- Lo que queda por cobrar: el índice cubre justo esa consulta.
create index if not exists idx_mov_recobro_pendiente
  on public.movimientos_extracto(entidad_id, recobro_tercero_id, fecha)
  where recobro_tercero_id is not null and recobro_venta_id is null;

-- ---------------------------------------------------------------------
-- Vista de gastos por recobrar, con el IVA que ya cobró el banco por el
-- servicio digital importado —que es crédito tributario, no costo— y el
-- valor a facturar con IVA del 15 %.
-- ---------------------------------------------------------------------
create or replace view public.v_recobros_pendientes
with (security_invoker = true) as
select
  m.entidad_id,
  m.recobro_tercero_id                        as tercero_id,
  t.razon_social                              as tercero,
  date_trunc('month', m.fecha)::date          as mes,
  m.id                                        as movimiento_id,
  m.fecha,
  coalesce(m.comercio, m.descripcion)         as concepto,
  cf.nombre                                   as tarjeta,
  m.monto                                     as base,
  round(m.monto * 0.15, 2)                    as iva,
  round(m.monto * 1.15, 2)                    as total
from public.movimientos_extracto m
join public.terceros t on t.id = m.recobro_tercero_id
left join public.cuentas_financieras cf on cf.id = m.cuenta_id
where m.recobro_venta_id is null
  and m.naturaleza = 'DEBITO';

comment on view public.v_recobros_pendientes is
  'Gastos marcados como recobrables que todavía no se han facturado a su tercero.';
