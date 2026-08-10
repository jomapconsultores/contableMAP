-- =====================================================================
-- ContableMAP · 0009 · Estados financieros
-- Estado de Resultados (P y G) y Balance General, derivados del balance
-- de sumas y saldos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Estado de Resultados del período
-- ---------------------------------------------------------------------
create or replace function public.fn_estado_resultados(
  p_entidad uuid, p_desde date, p_hasta date
)
returns jsonb
language plpgsql stable as $$
declare
  v_ingresos      numeric(16,2) := 0;
  v_costos        numeric(16,2) := 0;
  v_gastos_op     numeric(16,2) := 0;
  v_gastos_fin    numeric(16,2) := 0;
  v_gastos_pers   numeric(16,2) := 0;
  v_no_deducible  numeric(16,2) := 0;
  v_detalle       jsonb := '[]'::jsonb;
  r               record;
begin
  for r in
    select * from public.fn_balance_saldos(p_entidad, p_desde, p_hasta)
     where tipo in ('INGRESO','COSTO','GASTO')
  loop
    v_detalle := v_detalle || jsonb_build_object(
      'codigo', r.codigo, 'cuenta', r.cuenta, 'tipo', r.tipo,
      'subtipo', r.subtipo, 'saldo', r.saldo_final
    );

    if    r.tipo = 'INGRESO' then v_ingresos := v_ingresos + r.saldo_final;
    elsif r.tipo = 'COSTO'   then v_costos   := v_costos   + r.saldo_final;
    else
      case r.subtipo
        when 'FINANCIERO'   then v_gastos_fin   := v_gastos_fin   + r.saldo_final;
        when 'PERSONAL'     then v_gastos_pers  := v_gastos_pers  + r.saldo_final;
        when 'NO_DEDUCIBLE' then v_no_deducible := v_no_deducible + r.saldo_final;
        else                     v_gastos_op    := v_gastos_op    + r.saldo_final;
      end case;
    end if;
  end loop;

  return jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'ingresos',            v_ingresos,
    'costo_ventas',        v_costos,
    'utilidad_bruta',      v_ingresos - v_costos,
    'gastos_operativos',   v_gastos_op,
    'utilidad_operativa',  v_ingresos - v_costos - v_gastos_op,
    'gastos_financieros',  v_gastos_fin,
    'gastos_personales',   v_gastos_pers,
    'gastos_no_deducibles', v_no_deducible,
    'total_gastos',        v_gastos_op + v_gastos_fin + v_gastos_pers + v_no_deducible,
    'resultado_ejercicio', v_ingresos - v_costos - v_gastos_op - v_gastos_fin
                             - v_gastos_pers - v_no_deducible,
    'detalle',             v_detalle
  );
end $$;

-- ---------------------------------------------------------------------
-- Balance General a una fecha de corte.
-- El resultado del ejercicio se calcula y se suma al patrimonio para que
-- la ecuación contable cierre sin necesidad de un asiento de cierre.
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
  v_detalle       jsonb := '[]'::jsonb;
  r               record;
begin
  -- Para cuentas de balance el "desde" es irrelevante: acumulan desde el
  -- origen. Se usa una fecha muy anterior para capturar todo el histórico.
  for r in
    select * from public.fn_balance_saldos(p_entidad, '1900-01-01'::date, p_hasta)
     where tipo in ('ACTIVO','PASIVO','PATRIMONIO')
  loop
    v_detalle := v_detalle || jsonb_build_object(
      'codigo', r.codigo, 'cuenta', r.cuenta, 'tipo', r.tipo,
      'subtipo', r.subtipo, 'saldo', r.saldo_final
    );

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

  v_resultado := (public.fn_estado_resultados(p_entidad, v_inicio, p_hasta)
                    ->> 'resultado_ejercicio')::numeric;

  return jsonb_build_object(
    'fecha_corte',        p_hasta,
    'activo_corriente',   v_activo_c,
    'activo_no_corriente', v_activo_nc,
    'total_activo',       v_activo_c + v_activo_nc,
    'pasivo_corriente',   v_pasivo_c,
    'pasivo_no_corriente', v_pasivo_nc,
    'total_pasivo',       v_pasivo_c + v_pasivo_nc,
    'patrimonio_inicial', v_patrimonio,
    'resultado_ejercicio', v_resultado,
    'total_patrimonio',   v_patrimonio + v_resultado,
    'pasivo_mas_patrimonio', v_pasivo_c + v_pasivo_nc + v_patrimonio + v_resultado,
    -- Si el descuadre no es cero hay asientos incompletos
    'descuadre',          round((v_activo_c + v_activo_nc)
                                - (v_pasivo_c + v_pasivo_nc + v_patrimonio + v_resultado), 2),
    'detalle',            v_detalle
  );
end $$;

-- ---------------------------------------------------------------------
-- Indicadores para el panel principal
-- ---------------------------------------------------------------------
create or replace function public.fn_dashboard(
  p_entidad uuid, p_anio int, p_mes int
)
returns jsonb
language plpgsql stable as $$
declare
  v_desde date := make_date(p_anio, p_mes, 1);
  v_hasta date := (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date;
  v_pyg   jsonb;
  v_iva   jsonb;
  v_cxc   numeric(16,2);
  v_cxp   numeric(16,2);
  v_vencido numeric(16,2);
  v_sin_clasificar int;
  v_docs_pendientes int;
begin
  v_pyg := public.fn_estado_resultados(p_entidad, make_date(p_anio,1,1), v_hasta);
  v_iva := public.fn_calcular_iva(p_entidad, p_anio, p_mes);

  select coalesce(sum(saldo),0) into v_cxc from public.cartera
   where entidad_id = p_entidad and clase in ('CXC','DOC_COBRAR')
     and estado in ('PENDIENTE','PARCIAL');

  select coalesce(sum(saldo),0) into v_cxp from public.cartera
   where entidad_id = p_entidad and clase in ('CXP','DOC_PAGAR')
     and estado in ('PENDIENTE','PARCIAL');

  select coalesce(sum(saldo),0) into v_vencido from public.cartera
   where entidad_id = p_entidad and estado in ('PENDIENTE','PARCIAL')
     and fecha_vencimiento < current_date;

  select count(*) into v_sin_clasificar from public.movimientos_extracto
   where entidad_id = p_entidad and categoria_id is null;

  select count(*) into v_docs_pendientes from public.documentos
   where entidad_id = p_entidad and estado in ('PENDIENTE','PROCESANDO');

  return jsonb_build_object(
    'periodo', jsonb_build_object('anio', p_anio, 'mes', p_mes),
    'resultados', v_pyg,
    'iva', v_iva -> 'resumen',
    'cartera', jsonb_build_object(
      'por_cobrar', v_cxc, 'por_pagar', v_cxp, 'vencido', v_vencido),
    'credito_tributario_iva', public.fn_saldo_credito_tributario(p_entidad,'IVA',p_anio,p_mes),
    'pendientes', jsonb_build_object(
      'movimientos_sin_clasificar', v_sin_clasificar,
      'documentos_por_procesar',    v_docs_pendientes)
  );
end $$;
