-- ---------------------------------------------------------------------
-- Las reglas que el motor daba por supuestas
--
-- Revisión del motor contable y fiscal. Cada bloque cierra una puerta por la
-- que hoy podía entrar una cifra equivocada sin que nada avisara:
--
--   1. Un mismo origen —un movimiento, una compra, un abono— podía generar dos
--      asientos con dos clics seguidos.
--   2. Un período cerrado solo se defendía al pasar un asiento a
--      CONTABILIZADO: sus líneas se podían cambiar o borrar, el asiento se
--      podía anular o mudar de fecha.
--   3. Un asiento ya contabilizado podía quedar descuadrado si alguien tocaba
--      sus líneas después, porque el cuadre solo se miraba una vez.
--   4. Las notas de crédito sumaban en el 104 como si fueran facturas.
--   5. El crédito tributario de IVA era la suma de todo el IVA de compras de la
--      historia: nunca se descontaba lo ya compensado, y la retención de IVA
--      recibida entraba dos veces —en su mes y otra vez en el arrastre—.
--   6. El balance general solo sumaba el resultado del año en curso: sin un
--      asiento de cierre, el de los años anteriores desaparecía y el balance
--      descuadraba en lo que valía ese resultado.
--   7. Las vistas de control contaban también los asientos anulados.
--   8. Una entidad nueva nacía sin la cuenta puente de traspasos ni la del
--      sueldo pendiente, y el primer rol de pago fallaba.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. Un origen, un asiento vivo
-- ---------------------------------------------------------------------
create unique index if not exists uq_asientos_origen_vivo
  on public.asientos (origen, origen_id)
  where origen_id is not null and estado <> 'ANULADO';

-- ---------------------------------------------------------------------
-- 2 y 3. El período cerrado no se toca, y lo contabilizado siempre cuadra
-- ---------------------------------------------------------------------
create or replace function public.fn_periodo_cerrado(p_entidad uuid, p_fecha date)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.periodos
     where entidad_id = p_entidad
       and anio = extract(year from p_fecha)::int
       and mes  = extract(month from p_fecha)::int
       and estado = 'CERRADO');
$$;

-- El asiento: no se contabiliza descuadrado ni en un mes cerrado, y lo que ya
-- está contabilizado en un mes cerrado no se anula, no se devuelve a borrador
-- ni se muda de fecha.
create or replace function public.tg_valida_asiento_contabilizado()
returns trigger language plpgsql as $$
declare
  v_debe   numeric(16,2);
  v_haber  numeric(16,2);
  v_lineas int;
begin
  if tg_op = 'UPDATE'
     and old.estado = 'CONTABILIZADO'
     and public.fn_periodo_cerrado(old.entidad_id, old.fecha)
     and (new.estado is distinct from old.estado or new.fecha is distinct from old.fecha)
  then
    raise exception 'El período % ya está cerrado: su asiento no se puede anular ni cambiar de fecha',
      to_char(old.fecha, 'YYYY-MM');
  end if;

  if new.estado <> 'CONTABILIZADO' then
    return new;
  end if;

  -- Insertarlo ya contabilizado se saltaría el cuadre: todavía no tiene líneas.
  if tg_op = 'INSERT' then
    raise exception 'Un asiento nace en BORRADOR y se contabiliza cuando ya tiene sus líneas';
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

  if public.fn_periodo_cerrado(new.entidad_id, new.fecha) then
    raise exception 'El período % ya está cerrado', to_char(new.fecha, 'YYYY-MM');
  end if;

  return new;
end $$;

drop trigger if exists valida_asiento on public.asientos;
create trigger valida_asiento before insert or update on public.asientos
for each row execute function public.tg_valida_asiento_contabilizado();

create or replace function public.tg_asiento_no_borrar_cerrado()
returns trigger language plpgsql as $$
begin
  if old.estado = 'CONTABILIZADO' and public.fn_periodo_cerrado(old.entidad_id, old.fecha) then
    raise exception 'El período % ya está cerrado: su asiento no se puede borrar',
      to_char(old.fecha, 'YYYY-MM');
  end if;
  return old;
end $$;

drop trigger if exists asiento_no_borrar_cerrado on public.asientos;
create trigger asiento_no_borrar_cerrado before delete on public.asientos
for each row execute function public.tg_asiento_no_borrar_cerrado();

-- Las líneas de un asiento contabilizado en un mes cerrado no se tocan.
create or replace function public.tg_linea_periodo_cerrado()
returns trigger language plpgsql as $$
declare
  v_ids uuid[];
begin
  v_ids := case tg_op
             when 'INSERT' then array[new.asiento_id]
             when 'DELETE' then array[old.asiento_id]
             else array[new.asiento_id, old.asiento_id]
           end;

  if exists (
    select 1 from public.asientos a
     where a.id = any(v_ids)
       and a.estado = 'CONTABILIZADO'
       and public.fn_periodo_cerrado(a.entidad_id, a.fecha))
  then
    raise exception 'El asiento pertenece a un período cerrado: sus líneas no se pueden modificar';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists linea_periodo_cerrado on public.asiento_lineas;
create trigger linea_periodo_cerrado before insert or update or delete on public.asiento_lineas
for each row execute function public.tg_linea_periodo_cerrado();

-- Al final de la transacción, todo asiento contabilizado cuyas líneas se
-- tocaron sigue cuadrando. Diferido: dentro de la transacción se puede pasar
-- por estados intermedios, como hace un traslado de importe entre dos líneas.
create or replace function public.tg_linea_mantiene_cuadre()
returns trigger language plpgsql as $$
declare
  v_id     uuid := case when tg_op = 'DELETE' then old.asiento_id else new.asiento_id end;
  v_debe   numeric(16,2);
  v_haber  numeric(16,2);
  v_lineas int;
begin
  if not exists (select 1 from public.asientos where id = v_id and estado = 'CONTABILIZADO') then
    return null;
  end if;

  select coalesce(sum(debe),0), coalesce(sum(haber),0), count(*)
    into v_debe, v_haber, v_lineas
    from public.asiento_lineas where asiento_id = v_id;

  if v_lineas < 2 or v_debe <> v_haber then
    raise exception 'El asiento contabilizado % quedaría descuadrado: debe % <> haber %',
      v_id, v_debe, v_haber;
  end if;

  return null;
end $$;

drop trigger if exists linea_mantiene_cuadre on public.asiento_lineas;
create constraint trigger linea_mantiene_cuadre
after insert or update or delete on public.asiento_lineas
deferrable initially deferred
for each row execute function public.tg_linea_mantiene_cuadre();

-- ---------------------------------------------------------------------
-- 4. La nota de crédito resta
-- ---------------------------------------------------------------------
create or replace function public.fn_resumen_ventas(
  p_entidad uuid, p_desde date, p_hasta date
)
returns table (
  base_gravada numeric, base_0 numeric, no_objeto numeric, exento numeric,
  iva_generado numeric, total numeric
)
language sql stable as $$
  with v as (
    select *, case when tipo_comprobante = 'NOTA_CREDITO' then -1 else 1 end as signo
      from public.ventas
     where entidad_id = p_entidad
       and fecha between p_desde and p_hasta
       and estado <> 'ANULADA'
  )
  select
    coalesce(sum(signo * (base_5 + base_8 + base_15)), 0)::numeric(16,2),
    coalesce(sum(signo * base_0), 0)::numeric(16,2),
    coalesce(sum(signo * no_objeto_iva), 0)::numeric(16,2),
    coalesce(sum(signo * exento_iva), 0)::numeric(16,2),
    coalesce(sum(signo * (iva_5 + iva_8 + iva_15)), 0)::numeric(16,2),
    coalesce(sum(signo * total), 0)::numeric(16,2)
  from v;
$$;

create or replace function public.fn_resumen_compras(
  p_entidad uuid, p_desde date, p_hasta date
)
returns table (
  base_gravada numeric, base_0 numeric, no_objeto numeric, exento numeric,
  iva_pagado numeric, iva_con_credito numeric, total numeric
)
language sql stable as $$
  with c as (
    select *, case when tipo_comprobante = 'NOTA_CREDITO' then -1 else 1 end as signo
      from public.compras
     where entidad_id = p_entidad
       and fecha between p_desde and p_hasta
       and estado <> 'ANULADA'
  )
  select
    coalesce(sum(signo * (base_5 + base_8 + base_15)), 0)::numeric(16,2),
    coalesce(sum(signo * base_0), 0)::numeric(16,2),
    coalesce(sum(signo * no_objeto_iva), 0)::numeric(16,2),
    coalesce(sum(signo * exento_iva), 0)::numeric(16,2),
    coalesce(sum(signo * (iva_5 + iva_8 + iva_15)), 0)::numeric(16,2),
    coalesce(sum(case when da_credito_iva then signo * (iva_5 + iva_8 + iva_15) else 0 end), 0)::numeric(16,2),
    coalesce(sum(signo * total), 0)::numeric(16,2)
  from c;
$$;

-- ---------------------------------------------------------------------
-- 5. El crédito de IVA se arrastra mes a mes, como en el formulario
--
-- El crédito que pasa al mes siguiente es el casillero 609 del mes anterior,
-- y ese se calcula a partir del 609 del anterior a él. Se recorre la historia
-- desde el primer mes con actividad aplicando la misma regla del 104. El IVA
-- de compras y las retenciones salen de sus tablas de origen; de
-- `credito_tributario` solo se toman los ajustes que no tienen otro origen:
-- saldo de arranque, ajustes, devoluciones y aplicaciones manuales.
-- ---------------------------------------------------------------------
create or replace function public.fn_ajustes_credito_iva(p_entidad uuid, p_anio int, p_mes int)
returns numeric language sql stable as $$
  select coalesce(sum(monto), 0)::numeric(16,2)
    from public.credito_tributario
   where entidad_id = p_entidad
     and impuesto = 'IVA'
     and tipo in ('SALDO_ANTERIOR','AJUSTE','DEVOLUCION','APLICACION')
     and anio = p_anio
     and coalesce(mes, 12) = p_mes;
$$;

create or replace function public.fn_credito_iva_al_cierre(p_entidad uuid, p_anio int, p_mes int)
returns numeric
language plpgsql stable as $$
declare
  v_hasta   date := make_date(p_anio, p_mes, 1);
  v_mes     date;
  v_credito numeric(16,2) := 0;
  v_ret     numeric(16,2);
  v         record;
  c         record;
  v_causado numeric(16,2);
begin
  select min(m) into v_mes from (
    select date_trunc('month', min(fecha))::date as m from public.ventas
     where entidad_id = p_entidad
    union all
    select date_trunc('month', min(fecha))::date from public.compras
     where entidad_id = p_entidad
    union all
    select date_trunc('month', min(fecha))::date from public.retenciones
     where entidad_id = p_entidad
    union all
    select min(make_date(anio, coalesce(mes, 12), 1)) from public.credito_tributario
     where entidad_id = p_entidad and impuesto = 'IVA'
       and tipo in ('SALDO_ANTERIOR','AJUSTE','DEVOLUCION','APLICACION')
  ) t;

  if v_mes is null then
    return 0;
  end if;

  while v_mes <= v_hasta loop
    select * into v from public.fn_resumen_ventas(
      p_entidad, v_mes, (v_mes + interval '1 month - 1 day')::date);
    select * into c from public.fn_resumen_compras(
      p_entidad, v_mes, (v_mes + interval '1 month - 1 day')::date);

    select coalesce(sum(ret_iva), 0) into v_ret
      from public.retenciones
     where entidad_id = p_entidad and clase = 'RECIBIDA'
       and fecha between v_mes and (v_mes + interval '1 month - 1 day')::date
       and estado <> 'ANULADA';

    v_credito := v_credito + public.fn_ajustes_credito_iva(
      p_entidad, extract(year from v_mes)::int, extract(month from v_mes)::int);

    v_causado := greatest(v.iva_generado - c.iva_con_credito, 0);
    if v_causado > 0 then
      v_credito := greatest(v_credito + v_ret - v_causado, 0);
    else
      v_credito := v_credito + v_ret + greatest(c.iva_con_credito - v.iva_generado, 0);
    end if;

    v_mes := (v_mes + interval '1 month')::date;
  end loop;

  return v_credito;
end $$;

comment on function public.fn_credito_iva_al_cierre(uuid, int, int) is
  'Crédito tributario de IVA que pasa al mes siguiente (casillero 609) al cierre del mes dado.';

-- El saldo que muestra el panel es el mismo arrastre. El de renta sí es una
-- acumulación: sus retenciones se descuentan una sola vez, en el 102 anual.
create or replace function public.fn_saldo_credito_tributario(
  p_entidad  uuid,
  p_impuesto text,
  p_anio     int,
  p_mes      int default 12
)
returns numeric
language sql stable as $$
  select case
    when p_impuesto = 'IVA' then public.fn_credito_iva_al_cierre(p_entidad, p_anio, p_mes)
    else (select coalesce(sum(monto), 0)::numeric(16,2)
            from public.credito_tributario
           where entidad_id = p_entidad
             and impuesto   = p_impuesto
             and (anio < p_anio or (anio = p_anio and coalesce(mes, 12) <= p_mes)))
  end;
$$;

create or replace function public.fn_calcular_iva(
  p_entidad uuid, p_anio int, p_mes int
)
returns jsonb
language plpgsql stable as $$
declare
  v_desde date := make_date(p_anio, p_mes, 1);
  v_hasta date := (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date;
  v          record;   -- ventas
  c          record;   -- compras
  v_ret_iva_recibida  numeric(16,2);
  v_ret_iva_efectuada numeric(16,2);
  v_credito_anterior  numeric(16,2);
  v_impuesto_causado  numeric(16,2);
  v_credito_disponible numeric(16,2);
  v_a_pagar           numeric(16,2);
  v_credito_siguiente numeric(16,2);
begin
  select * into v from public.fn_resumen_ventas(p_entidad, v_desde, v_hasta);
  select * into c from public.fn_resumen_compras(p_entidad, v_desde, v_hasta);

  -- Retenciones de IVA que nos efectuaron en el período (crédito a favor)
  select coalesce(sum(ret_iva), 0) into v_ret_iva_recibida
    from public.retenciones
   where entidad_id = p_entidad and clase = 'RECIBIDA'
     and fecha between v_desde and v_hasta and estado <> 'ANULADA';

  -- Retenciones de IVA que efectuamos como agente (se pagan al SRI)
  select coalesce(sum(ret_iva), 0) into v_ret_iva_efectuada
    from public.retenciones
   where entidad_id = p_entidad and clase = 'EFECTUADA'
     and fecha between v_desde and v_hasta and estado <> 'ANULADA';

  -- El 609 del mes anterior, más los ajustes manuales de este mes
  v_credito_anterior := public.fn_credito_iva_al_cierre(
    p_entidad,
    case when p_mes = 1 then p_anio - 1 else p_anio end,
    case when p_mes = 1 then 12 else p_mes - 1 end
  ) + public.fn_ajustes_credito_iva(p_entidad, p_anio, p_mes);

  v_impuesto_causado   := greatest(v.iva_generado - c.iva_con_credito, 0);
  v_credito_disponible := v_credito_anterior + v_ret_iva_recibida
                          + greatest(c.iva_con_credito - v.iva_generado, 0);

  if v_impuesto_causado > 0 then
    v_a_pagar           := greatest(v_impuesto_causado - v_credito_anterior - v_ret_iva_recibida, 0);
    v_credito_siguiente := greatest(v_credito_anterior + v_ret_iva_recibida - v_impuesto_causado, 0);
  else
    v_a_pagar           := 0;
    v_credito_siguiente := v_credito_disponible;
  end if;

  return jsonb_build_object(
    'periodo', jsonb_build_object('anio', p_anio, 'mes', p_mes,
                                  'desde', v_desde, 'hasta', v_hasta),
    'ventas', jsonb_build_object(
      'c401_ventas_gravadas',        v.base_gravada,
      'c405_ventas_tarifa_0',        v.base_0,
      'c411_no_objeto',              v.no_objeto,
      'c412_exentas',                v.exento,
      'c419_total_ventas',           v.total,
      'c480_iva_generado',           v.iva_generado
    ),
    'compras', jsonb_build_object(
      'c500_adquisiciones_gravadas', c.base_gravada,
      'c507_adquisiciones_tarifa_0', c.base_0,
      'c510_no_objeto',              c.no_objeto,
      'c511_exentas',                c.exento,
      'c517_total_adquisiciones',    c.total,
      'c520_iva_compras',            c.iva_pagado,
      'c521_iva_con_derecho_credito', c.iva_con_credito
    ),
    'resumen', jsonb_build_object(
      'c601_impuesto_causado',           v_impuesto_causado,
      'c602_credito_periodo_anterior',   v_credito_anterior,
      'c605_retenciones_iva_recibidas',  v_ret_iva_recibida,
      'c609_credito_proximo_periodo',    v_credito_siguiente,
      'c619_impuesto_a_pagar',           v_a_pagar,
      'retenciones_iva_efectuadas',      v_ret_iva_efectuada,
      'c799_total_a_pagar',              v_a_pagar + v_ret_iva_efectuada
    )
  );
end $$;

-- ---------------------------------------------------------------------
-- 6. El balance cuadra con o sin asiento de cierre
--
-- El resultado que va al patrimonio es el de todas las cuentas de ingreso,
-- costo y gasto hasta la fecha de corte. Si un año se cerró, su asiento de
-- cierre ya las dejó en cero y su resultado está en resultados acumulados; si
-- no se cerró, aparece aparte como resultado de ejercicios anteriores. En
-- ningún caso se pierde.
-- ---------------------------------------------------------------------
create or replace function public.fn_balance_general(
  p_entidad uuid, p_hasta date, p_inicio_ejercicio date default null
)
returns jsonb
language plpgsql stable as $$
declare
  v_inicio        date := coalesce(p_inicio_ejercicio, date_trunc('year', p_hasta)::date);
  v_activo_c      numeric(16,2) := 0;
  v_activo_nc     numeric(16,2) := 0;
  v_pasivo_c      numeric(16,2) := 0;
  v_pasivo_nc     numeric(16,2) := 0;
  v_patrimonio    numeric(16,2) := 0;
  v_resultado     numeric(16,2);
  v_anteriores    numeric(16,2);
  v_detalle       jsonb;
  r               record;
begin
  -- Para cuentas de balance el "desde" es irrelevante: acumulan desde el
  -- origen. Se usa una fecha muy anterior para capturar todo el histórico.
  for r in
    select * from public.fn_balance_saldos(p_entidad, '1900-01-01'::date, p_hasta)
     where tipo in ('ACTIVO','PASIVO','PATRIMONIO')
  loop
    if r.tipo = 'ACTIVO' then
      if r.subtipo = 'NO_CORRIENTE' then v_activo_nc := v_activo_nc + r.saldo_final;
      else                               v_activo_c  := v_activo_c  + r.saldo_final;
      end if;
    elsif r.tipo = 'PASIVO' then
      if r.subtipo = 'NO_CORRIENTE' then v_pasivo_nc := v_pasivo_nc + r.saldo_final;
      else                               v_pasivo_c  := v_pasivo_c  + r.saldo_final;
      end if;
    else
      v_patrimonio := v_patrimonio + r.saldo_final;
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'codigo', codigo, 'cuenta', cuenta, 'tipo', tipo, 'subtipo', subtipo,
           'nivel', nivel, 'padre', padre, 'hoja', es_hoja, 'saldo', saldo
         ) order by codigo), '[]'::jsonb)
    into v_detalle
    from public.fn_saldos_arbol(p_entidad, '1900-01-01'::date, p_hasta)
   where tipo in ('ACTIVO','PASIVO','PATRIMONIO');

  -- Resultado del ejercicio y de los anteriores que no se cerraron. Los
  -- asientos de cierre se incluyen: son los que trasladan lo cerrado al
  -- patrimonio, y lo que trasladan deja de contar aquí.
  select coalesce(sum(case when m.fecha >= v_inicio then m.haber - m.debe else 0 end), 0),
         coalesce(sum(case when m.fecha <  v_inicio then m.haber - m.debe else 0 end), 0)
    into v_resultado, v_anteriores
    from public.v_libro_mayor m
   where m.entidad_id = p_entidad
     and m.fecha <= p_hasta
     and m.tipo_cuenta in ('INGRESO','COSTO','GASTO');

  return jsonb_build_object(
    'fecha_corte',        p_hasta,
    'activo_corriente',   v_activo_c,
    'activo_no_corriente', v_activo_nc,
    'total_activo',       v_activo_c + v_activo_nc,
    'pasivo_corriente',   v_pasivo_c,
    'pasivo_no_corriente', v_pasivo_nc,
    'total_pasivo',       v_pasivo_c + v_pasivo_nc,
    'patrimonio_inicial', v_patrimonio,
    'resultados_anteriores_sin_cerrar', v_anteriores,
    'resultado_ejercicio', v_resultado,
    'total_patrimonio',   v_patrimonio + v_anteriores + v_resultado,
    'pasivo_mas_patrimonio', v_pasivo_c + v_pasivo_nc + v_patrimonio + v_anteriores + v_resultado,
    -- Con el resultado completo, un descuadre solo puede venir de un asiento
    -- que no cuadra, y eso la base ya no lo admite.
    'descuadre',          round((v_activo_c + v_activo_nc)
                                - (v_pasivo_c + v_pasivo_nc + v_patrimonio + v_anteriores + v_resultado), 2),
    'detalle',            v_detalle
  );
end $$;

-- ---------------------------------------------------------------------
-- 7. Las vistas de control miran solo lo contabilizado
-- ---------------------------------------------------------------------
create or replace view public.v_traspasos_sin_cuadrar
with (security_invoker = true) as
select
  a.entidad_id,
  sum(l.debe)  as debe,
  sum(l.haber) as haber,
  round(sum(l.debe) - sum(l.haber), 2) as descuadre
from public.asiento_lineas l
join public.asientos a on a.id = l.asiento_id
join public.plan_cuentas p on p.id = l.cuenta_id
where p.codigo = '1.1.01.99'
  and a.estado = 'CONTABILIZADO'
group by a.entidad_id
having round(sum(l.debe) - sum(l.haber), 2) <> 0;

create or replace view public.v_sueldos_sin_acreditar
with (security_invoker = true) as
select
  a.entidad_id,
  round(sum(l.haber) - sum(l.debe), 2) as pendiente_de_acreditar
from public.asiento_lineas l
join public.asientos a on a.id = l.asiento_id
join public.plan_cuentas p on p.id = l.cuenta_id
where p.codigo = '2.1.07'
  and a.estado = 'CONTABILIZADO'
group by a.entidad_id
having round(sum(l.haber) - sum(l.debe), 2) <> 0;

-- ---------------------------------------------------------------------
-- 8. Una entidad nueva nace con todo lo que el motor necesita
-- ---------------------------------------------------------------------
create or replace function public.tg_provisiona_entidad()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  perform public.fn_seed_plan_cuentas(new.id);
  perform public.fn_seed_categorias(new.id);
  perform public.fn_sembrar_traspasos(new.id);
  perform public.fn_sembrar_acreditacion_sueldo(new.id);
  return new;
end $$;
