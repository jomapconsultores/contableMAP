-- =====================================================================
-- ContableMAP · 0006 · Declaraciones
-- Formulario 104 (IVA), gastos personales y Formulario 102 (Renta).
--
-- NOTA: los números de casillero siguen la estructura vigente del
-- formulario 104. El SRI los renumera cuando reforma el formulario, por
-- eso se generan como JSON etiquetado y se guardan versionados en
-- `declaraciones.detalle`, en lugar de fijarse en columnas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Declaraciones presentadas / en borrador
-- ---------------------------------------------------------------------
create table if not exists public.declaraciones (
  id              uuid primary key default gen_random_uuid(),
  entidad_id      uuid not null references public.entidades(id) on delete cascade,
  tipo            text not null check (tipo in ('IVA','RENTA','ANEXO_ATS','ANEXO_GP')),
  anio            int not null,
  mes             int check (mes between 1 and 12),
  semestre        int check (semestre in (1,2)),
  -- Casilleros calculados
  detalle         jsonb not null default '{}'::jsonb,
  total_pagar     numeric(16,2) not null default 0,
  estado          text not null default 'BORRADOR'
                    check (estado in ('BORRADOR','CALCULADA','PRESENTADA','PAGADA')),
  presentada_at   timestamptz,
  numero_adhesivo text,
  notas           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Una sola declaración por entidad, tipo y período (mes o semestre)
create unique index if not exists uq_declaraciones_periodo
  on public.declaraciones (entidad_id, tipo, anio, coalesce(mes, 0), coalesce(semestre, 0));

create index if not exists idx_declaraciones_entidad on public.declaraciones(entidad_id, tipo, anio desc);

drop trigger if exists set_updated_at on public.declaraciones;
create trigger set_updated_at before update on public.declaraciones
for each row execute function public.tg_set_updated_at();

alter table public.credito_tributario
  drop constraint if exists credito_tributario_declaracion_id_fkey;
alter table public.credito_tributario
  add constraint credito_tributario_declaracion_id_fkey
  foreign key (declaracion_id) references public.declaraciones(id) on delete set null;

-- ---------------------------------------------------------------------
-- Resumen de ventas del período
-- ---------------------------------------------------------------------
create or replace function public.fn_resumen_ventas(
  p_entidad uuid, p_desde date, p_hasta date
)
returns table (
  base_gravada numeric, base_0 numeric, no_objeto numeric, exento numeric,
  iva_generado numeric, total numeric
)
language sql stable as $$
  select
    coalesce(sum(base_5 + base_8 + base_15), 0)::numeric(16,2),
    coalesce(sum(base_0), 0)::numeric(16,2),
    coalesce(sum(no_objeto_iva), 0)::numeric(16,2),
    coalesce(sum(exento_iva), 0)::numeric(16,2),
    coalesce(sum(iva_5 + iva_8 + iva_15), 0)::numeric(16,2),
    coalesce(sum(total), 0)::numeric(16,2)
  from public.ventas
  where entidad_id = p_entidad
    and fecha between p_desde and p_hasta
    and estado <> 'ANULADA';
$$;

-- ---------------------------------------------------------------------
-- Resumen de compras del período (solo las que dan crédito de IVA
-- suman al crédito tributario)
-- ---------------------------------------------------------------------
create or replace function public.fn_resumen_compras(
  p_entidad uuid, p_desde date, p_hasta date
)
returns table (
  base_gravada numeric, base_0 numeric, no_objeto numeric, exento numeric,
  iva_pagado numeric, iva_con_credito numeric, total numeric
)
language sql stable as $$
  select
    coalesce(sum(base_5 + base_8 + base_15), 0)::numeric(16,2),
    coalesce(sum(base_0), 0)::numeric(16,2),
    coalesce(sum(no_objeto_iva), 0)::numeric(16,2),
    coalesce(sum(exento_iva), 0)::numeric(16,2),
    coalesce(sum(iva_5 + iva_8 + iva_15), 0)::numeric(16,2),
    coalesce(sum(case when da_credito_iva then iva_5 + iva_8 + iva_15 else 0 end), 0)::numeric(16,2),
    coalesce(sum(total), 0)::numeric(16,2)
  from public.compras
  where entidad_id = p_entidad
    and fecha between p_desde and p_hasta
    and estado <> 'ANULADA';
$$;

-- ---------------------------------------------------------------------
-- Formulario 104 · cálculo del período
-- ---------------------------------------------------------------------
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

  -- Crédito tributario arrastrado de períodos anteriores
  v_credito_anterior := public.fn_saldo_credito_tributario(
    p_entidad, 'IVA',
    case when p_mes = 1 then p_anio - 1 else p_anio end,
    case when p_mes = 1 then 12 else p_mes - 1 end
  );

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
-- Gastos personales deducibles del ejercicio, por rubro y con topes.
-- Los topes se leen de `parametros_fiscales` (canastas básicas por rubro).
-- ---------------------------------------------------------------------
create or replace function public.fn_gastos_personales(
  p_entidad uuid, p_anio int
)
returns jsonb
language plpgsql stable as $$
declare
  v_param   record;
  v_rubro   record;
  v_result  jsonb := '[]'::jsonb;
  v_total   numeric(16,2) := 0;
  v_tope_global numeric(16,2);
  v_deducible numeric(16,2);
  v_rebaja  numeric(16,2);
begin
  select * into v_param from public.parametros_fiscales where anio = p_anio;
  if v_param is null then
    raise exception 'No hay parámetros fiscales cargados para el año %', p_anio;
  end if;

  for v_rubro in
    select coalesce(cp.rubro_personal, cg.rubro_personal) as rubro,
           sum(cp.total) as gastado
      from public.compras cp
      left join public.categorias_gasto cg on cg.id = cp.categoria_id
     where cp.entidad_id = p_entidad
       and extract(year from cp.fecha) = p_anio
       and cp.estado <> 'ANULADA'
       and coalesce(cp.rubro_personal, cg.rubro_personal) is not null
     group by 1
  loop
    -- Tope por rubro expresado en canastas básicas
    v_deducible := least(
      v_rubro.gastado,
      coalesce((v_param.topes_gastos_personales ->> v_rubro.rubro)::numeric, 0)
        * v_param.canasta_basica
    );
    v_total  := v_total + v_deducible;
    v_result := v_result || jsonb_build_object(
      'rubro',     v_rubro.rubro,
      'gastado',   v_rubro.gastado,
      'tope',      coalesce((v_param.topes_gastos_personales ->> v_rubro.rubro)::numeric, 0)
                     * v_param.canasta_basica,
      'deducible', v_deducible
    );
  end loop;

  -- Tope global sobre la suma de rubros
  v_tope_global := coalesce((v_param.topes_gastos_personales ->> 'GLOBAL')::numeric, 7)
                     * v_param.canasta_basica;
  v_total := least(v_total, v_tope_global);

  -- Desde la reforma de 2023 los gastos personales no se restan de la base
  -- imponible: generan una rebaja directa del impuesto causado.
  v_rebaja := round(v_total * v_param.porcentaje_rebaja_gp, 2);

  return jsonb_build_object(
    'anio',             p_anio,
    'canasta_basica',   v_param.canasta_basica,
    'rubros',           v_result,
    'tope_global',      v_tope_global,
    'total_deducible',  v_total,
    'porcentaje_rebaja', v_param.porcentaje_rebaja_gp,
    'rebaja_impuesto',  v_rebaja
  );
end $$;

-- ---------------------------------------------------------------------
-- Impuesto a la Renta anual (personas naturales).
-- Acumula ingresos (ventas + roles de pago), gastos deducibles,
-- aplica la tabla progresiva y descuenta retenciones.
-- ---------------------------------------------------------------------
create or replace function public.fn_calcular_renta(
  p_entidad uuid, p_anio int
)
returns jsonb
language plpgsql stable as $$
declare
  v_param            record;
  v_desde date := make_date(p_anio, 1, 1);
  v_hasta date := make_date(p_anio, 12, 31);
  v_ing_negocio      numeric(16,2);
  v_ing_dependencia  numeric(16,2);
  v_aporte_iess      numeric(16,2);
  v_gastos_deducibles numeric(16,2);
  v_base             numeric(16,2);
  v_impuesto         numeric(16,2) := 0;
  v_gp               jsonb;
  v_rebaja_gp        numeric(16,2);
  v_ret_renta        numeric(16,2);
  v_ret_dependencia  numeric(16,2);
  v_saldo            numeric(16,2);
  v_tramo            jsonb;
begin
  select * into v_param from public.parametros_fiscales where anio = p_anio;
  if v_param is null then
    raise exception 'No hay parámetros fiscales cargados para el año %', p_anio;
  end if;

  -- Ingresos por actividad económica (base imponible, sin IVA)
  select coalesce(sum(base_0 + base_5 + base_8 + base_15 + no_objeto_iva + exento_iva), 0)
    into v_ing_negocio
    from public.ventas
   where entidad_id = p_entidad and fecha between v_desde and v_hasta and estado <> 'ANULADA';

  -- Ingresos en relación de dependencia. Los décimos son exentos.
  select coalesce(sum(total_ingresos - decimo_tercero - decimo_cuarto), 0),
         coalesce(sum(aporte_iess), 0),
         coalesce(sum(impuesto_renta), 0)
    into v_ing_dependencia, v_aporte_iess, v_ret_dependencia
    from public.roles_pago
   where entidad_id = p_entidad and anio = p_anio and estado <> 'ANULADO';

  -- Gastos deducibles de la actividad
  select coalesce(sum(base_0 + base_5 + base_8 + base_15 + no_objeto_iva + exento_iva), 0)
    into v_gastos_deducibles
    from public.compras
   where entidad_id = p_entidad and fecha between v_desde and v_hasta
     and estado <> 'ANULADA' and deducible_ir;

  -- El aporte personal al IESS es deducible del ingreso en dependencia
  v_base := greatest(v_ing_negocio - v_gastos_deducibles
                     + v_ing_dependencia - v_aporte_iess, 0);

  -- Tabla progresiva del Impuesto a la Renta
  for v_tramo in select * from jsonb_array_elements(v_param.tabla_ir)
  loop
    if v_base > (v_tramo ->> 'desde')::numeric
       and (v_tramo ->> 'hasta' is null
            or v_base <= coalesce((v_tramo ->> 'hasta')::numeric, 'infinity'::numeric))
    then
      v_impuesto := (v_tramo ->> 'impuesto_fraccion_basica')::numeric
                    + (v_base - (v_tramo ->> 'desde')::numeric)
                      * (v_tramo ->> 'porcentaje_excedente')::numeric;
    end if;
  end loop;
  v_impuesto := round(greatest(v_impuesto, 0), 2);

  -- Rebaja por gastos personales
  v_gp        := public.fn_gastos_personales(p_entidad, p_anio);
  v_rebaja_gp := least((v_gp ->> 'rebaja_impuesto')::numeric, v_impuesto);

  -- Retenciones en la fuente de renta que nos efectuaron
  select coalesce(sum(ret_renta), 0) into v_ret_renta
    from public.retenciones
   where entidad_id = p_entidad and clase = 'RECIBIDA'
     and fecha between v_desde and v_hasta and estado <> 'ANULADA';

  v_saldo := round(v_impuesto - v_rebaja_gp - v_ret_renta - v_ret_dependencia, 2);

  return jsonb_build_object(
    'anio', p_anio,
    'ingresos', jsonb_build_object(
      'actividad_economica', v_ing_negocio,
      'relacion_dependencia', v_ing_dependencia,
      'total', v_ing_negocio + v_ing_dependencia
    ),
    'deducciones', jsonb_build_object(
      'gastos_actividad', v_gastos_deducibles,
      'aporte_iess',      v_aporte_iess
    ),
    'base_imponible',      v_base,
    'impuesto_causado',    v_impuesto,
    'gastos_personales',   v_gp,
    'rebaja_gastos_personales', v_rebaja_gp,
    'retenciones', jsonb_build_object(
      'en_la_fuente',      v_ret_renta,
      'relacion_dependencia', v_ret_dependencia
    ),
    'saldo',  v_saldo,
    'resultado', case when v_saldo > 0 then 'IMPUESTO_A_PAGAR'
                      when v_saldo < 0 then 'CREDITO_A_FAVOR'
                      else 'SIN_SALDO' end
  );
end $$;
