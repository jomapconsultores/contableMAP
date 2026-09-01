-- ---------------------------------------------------------------------
-- El desglose de los informes, en árbol
--
-- Ahora que cada banco, cada libreta de la cooperativa y cada tarjeta tienen su
-- cuenta, el desglose devolvía las hojas en una lista plana: once libretas
-- seguidas, sin decir que son la cooperativa ni cuánto suman entre todas.
-- Leerlo obligaba a sumar de cabeza.
--
-- Esta función devuelve las mismas cifras colgadas de su rama: cada cuenta de
-- agrupación con el total de lo que tiene debajo, y sus hijas dentro. Así la
-- pantalla puede mostrar «Cooperativas 2.728,79» y desplegarla para ver libreta
-- por libreta, y lo mismo con los bancos, las tarjetas, los gastos o cualquier
-- otra familia del plan.
--
-- El total de cada cuenta es la suma de sus descendientes de movimiento: una
-- cuenta de agrupación nunca tiene saldo propio, lo hereda de lo que cuelga.
-- ---------------------------------------------------------------------
create or replace function public.fn_saldos_arbol(
  p_entidad uuid, p_desde date, p_hasta date
)
returns table (
  codigo   text,
  cuenta   text,
  tipo     text,
  subtipo  text,
  nivel    int,
  padre    text,
  es_hoja  boolean,
  saldo    numeric(16,2)
)
language sql stable as $$
  with recursive hojas as (
    select s.cuenta_id, s.saldo_final
      from public.fn_balance_saldos(p_entidad, p_desde, p_hasta) s
  ),
  -- Cada saldo sube por la rama hasta la raíz, dejando copia en cada escalón.
  sube as (
    select h.cuenta_id as id, c.padre_id, h.saldo_final as saldo
      from hojas h
      join public.plan_cuentas c on c.id = h.cuenta_id
    union all
    select p.id, p.padre_id, s.saldo
      from sube s
      join public.plan_cuentas p on p.id = s.padre_id
  )
  select c.codigo,
         c.nombre,
         c.tipo,
         c.subtipo,
         c.nivel,
         pa.codigo,
         not exists (select 1 from public.plan_cuentas h where h.padre_id = c.id),
         sum(s.saldo)::numeric(16,2)
    from sube s
    join public.plan_cuentas c on c.id = s.id
    left join public.plan_cuentas pa on pa.id = c.padre_id
   group by c.id, c.codigo, c.nombre, c.tipo, c.subtipo, c.nivel, pa.codigo
   order by c.codigo;
$$;

comment on function public.fn_saldos_arbol(uuid, date, date) is
  'Saldos del período por cuenta y por rama: cada agrupación con el total de lo que cuelga.';

-- ---------------------------------------------------------------------
-- Los dos estados devuelven ese árbol como desglose.
--
-- Los totales de cabecera se siguen calculando sobre las cuentas de
-- movimiento: si se sumaran las filas del árbol, cada importe entraría tantas
-- veces como escalones tiene su rama.
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
  v_detalle       jsonb;
  r               record;
begin
  for r in
    select * from public.fn_balance_saldos(p_entidad, p_desde, p_hasta)
     where tipo in ('INGRESO','COSTO','GASTO')
  loop
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'codigo', codigo, 'cuenta', cuenta, 'tipo', tipo, 'subtipo', subtipo,
           'nivel', nivel, 'padre', padre, 'hoja', es_hoja, 'saldo', saldo
         ) order by codigo), '[]'::jsonb)
    into v_detalle
    from public.fn_saldos_arbol(p_entidad, p_desde, p_hasta)
   where tipo in ('INGRESO','COSTO','GASTO');

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
