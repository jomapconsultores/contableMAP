-- =====================================================================
-- ContableMAP · 0027 · Datos del panel
--
-- Dos preguntas que el panel no sabía contestar:
--   · ¿Cuánto hay en cada cuenta? Saldo contable de cada banco, tarjeta,
--     cooperativa y caja, y aparte lo que está cargado pero sin contabilizar,
--     para que un extracto recién subido se vea antes de revisarlo.
--   · ¿En qué se va el dinero? Gasto del período por categoría, contando
--     también lo aún no contabilizado: es lo que el usuario quiere ver el día
--     que sube el estado de cuenta, no semanas después.
--
-- Ambas corren con los permisos de quien llama (security invoker), así que
-- el RLS de las tablas se aplica igual que en cualquier consulta.
-- =====================================================================

create or replace function public.fn_saldos_cuentas(p_entidad uuid, p_hasta date)
returns table (
  cuenta_id              uuid,
  nombre                 text,
  tipo                   text,
  institucion            text,
  numero                 text,
  saldo                  numeric,
  pendiente              numeric,
  movimientos_pendientes bigint,
  ultimo_movimiento      date
)
language sql stable as $$
  -- En las tarjetas el saldo es deuda: crece con el haber. En las demás es
  -- dinero disponible: crece con el debe.
  select cf.id, cf.nombre, cf.tipo, cf.institucion, cf.numero,
         coalesce((
           select sum(case when cf.tipo = 'TARJETA_CREDITO' then l.haber - l.debe
                           else l.debe - l.haber end)
             from public.asiento_lineas l
             join public.asientos a on a.id = l.asiento_id
            where l.cuenta_id = cf.cuenta_id
              and a.estado = 'CONTABILIZADO'
              and a.fecha <= p_hasta
         ), 0),
         coalesce(p.monto, 0),
         coalesce(p.n, 0),
         (select max(m.fecha) from public.movimientos_extracto m where m.cuenta_id = cf.id)
    from public.cuentas_financieras cf
    left join lateral (
      select sum(case
                   when (m.naturaleza = 'DEBITO') = (cf.tipo = 'TARJETA_CREDITO') then m.monto
                   else -m.monto
                 end) as monto,
             count(*) as n
        from public.movimientos_extracto m
       where m.cuenta_id = cf.id
         and m.asiento_id is null
         and m.fecha <= p_hasta
    ) p on true
   where cf.entidad_id = p_entidad
     and cf.activo
   order by case cf.tipo when 'CAJA' then 0 when 'BANCO' then 1 when 'COOPERATIVA' then 2
                         when 'INVERSION' then 3 else 4 end,
            cf.nombre;
$$;

comment on function public.fn_saldos_cuentas(uuid, date) is
  'Saldo contable de cada cuenta financiera y lo cargado pendiente de contabilizar.';

create or replace function public.fn_gastos_categorias(p_entidad uuid, p_desde date, p_hasta date)
returns table (
  categoria   text,
  tipo_cuenta text,
  subtipo     text,
  total       numeric,
  movimientos bigint
)
language sql stable as $$
  -- Solo lo que es gasto o costo: un traspaso entre cuentas, un préstamo
  -- otorgado o el pago de una deuda vieja mueven dinero pero no se consumen.
  select c.nombre, p.tipo, p.subtipo, sum(m.monto), count(*)
    from public.movimientos_extracto m
    join public.categorias_gasto c on c.id = m.categoria_id
    join public.plan_cuentas p on p.id = c.cuenta_id
   where m.entidad_id = p_entidad
     and m.naturaleza = 'DEBITO'
     and m.fecha between p_desde and p_hasta
     and p.tipo in ('GASTO', 'COSTO')
   group by c.nombre, p.tipo, p.subtipo
   order by sum(m.monto) desc;
$$;

comment on function public.fn_gastos_categorias(uuid, date, date) is
  'Gasto por categoría en un período, contabilizado o no.';
