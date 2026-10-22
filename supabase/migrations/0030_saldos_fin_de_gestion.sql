-- ---------------------------------------------------------------------
-- Saldos de bancos, cooperativas y préstamos a la fecha de la declaración
-- patrimonial de fin de gestión (CSC, salida el 20/10/2026)
--
-- Los saldos se leyeron el 21 y 22/10/2026 en la banca en línea y en las
-- apps de cada entidad, con el titular delante:
--   · Jardín Azuayo: nueve libretas (la 2255157 no se pudo leer y no se toca).
--   · Mutualista Pichincha: cuenta constructiva 751,96 y préstamo 7.118,14.
--   · Banco Pichincha: 3333038300 454,58 · 2213904666 3,71 ·
--     2215056817 74,97 · 2215062956 178,59.
--   · Banco Guayaquil: ahorros 3,30. Los dos préstamos personales y la
--     American Express se unificaron el 03/08/2026 en el refinanciamiento de
--     consumo 00199574, a 120 meses: capital pendiente 27.856,67. La Amex
--     quedó en cero.
--   · Banco del Austro: ahorros 0400564825 38,72; préstamo 17.906,79.
--   · Produbanco: cuenta digital 23,16.
--
-- Criterio, el mismo de la 0029: el saldo final en libros tiene que ser el
-- del banco contando también lo ya cargado y aún sin contabilizar. Por eso el
-- ajuste se calcula contra «contabilizado + pendiente»: cuando se contabilicen
-- los movimientos pendientes, la cuenta queda en el saldo del banco y no se
-- cuenta nada dos veces.
--
-- La contrapartida es «Resultados acumulados», como en la 0019: son
-- movimientos que nunca se cargaron (cuotas pagadas, depósitos, intereses),
-- no un ingreso ni un gasto de este mes.
--
-- Las tarjetas de crédito, salvo la Amex, NO se tocan aquí: se cuadran
-- cargando sus extractos, que es lo que manda la 0029.
-- ---------------------------------------------------------------------

do $$
declare
  v_ent        uuid;
  v_asiento    uuid;
  v_orden      int := 0;
  v_patrimonio uuid;
  v_refin      uuid;
  v_total      numeric(16,2) := 0;
  v_actual     numeric(16,2);
  v_ajuste     numeric(16,2);
  v_cuenta     uuid;
  r            record;
begin
  select id into v_ent from public.entidades order by created_at limit 1;
  if v_ent is null then
    return;
  end if;
  select id into v_patrimonio from public.plan_cuentas where entidad_id = v_ent and codigo = '3.2';

  -- El préstamo nuevo del Guayaquil, con su propia cuenta.
  insert into public.plan_cuentas
    (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
  select v_ent, '2.2.01.05', 'Banco Guayaquil · refinanciamiento consumo 00199574',
         p.tipo, p.subtipo, p.naturaleza, p.id, p.nivel + 1, true
    from public.plan_cuentas p
   where p.entidad_id = v_ent and p.codigo = '2.2.01'
  on conflict (entidad_id, codigo) do nothing;
  select id into v_refin from public.plan_cuentas where entidad_id = v_ent and codigo = '2.2.01.05';

  insert into public.asientos (entidad_id, fecha, glosa, tipo, origen, estado)
  values (v_ent, '2026-10-21',
          'Saldos de bancos, cooperativas y préstamos a la declaración de fin de gestión (0030)',
          'DIARIO', 'MANUAL', 'BORRADOR')
  returning id into v_asiento;

  -- Cuentas financieras: el ajuste cuenta también lo pendiente de contabilizar.
  for r in
    select * from (values
      ('Coop. Jardín Azuayo - Ahorro 1939365',     1740.70),
      ('Coop. Jardín Azuayo - Ahorro 2774216',      105.92),
      ('Coop. Jardín Azuayo - Ahorro 2807514',        0.11),
      ('Coop. Jardín Azuayo - Ahorro 2830867',       10.91),
      ('Coop. Jardín Azuayo - Ahorro 2830868',       10.91),
      ('Coop. Jardín Azuayo - Ahorro 2830869',       10.91),
      ('Coop. Jardín Azuayo - Ahorro 2830870',       54.66),
      ('Coop. Jardín Azuayo - Ahorro 2830871',       10.91),
      ('Coop. Jardín Azuayo - Ahorro 2830872',       10.91),
      ('Mutualista Pichincha - Cta. Constructiva',  751.96),
      ('Banco Pichincha - Cta. Transaccional',      454.58),
      ('Banco Pichincha - Cta. Ahorro',               3.71),
      ('Banco Pichincha - Cta. 2215056817',          74.97),
      ('Banco Pichincha - Cta. 2215062956',         178.59),
      ('Banco Guayaquil - Cta. Ahorros',              3.30),
      ('Banco del Austro - Cta. Ahorro',             38.72),
      ('Produbanco - Cta. Digital',                  23.16),
      ('TC American Express Banco Guayaquil',         0.00)
    ) as t(nombre, objetivo)
  loop
    select s.saldo + s.pendiente, cf.cuenta_id into v_actual, v_cuenta
      from public.fn_saldos_cuentas(v_ent, date '2026-10-21') s
      join public.cuentas_financieras cf on cf.id = s.cuenta_id
     where cf.nombre = r.nombre;
    if v_cuenta is null then
      raise exception 'No existe la cuenta financiera %', r.nombre;
    end if;
    v_ajuste := round(r.objetivo - v_actual, 2);
    if v_ajuste <> 0 then
      v_orden := v_orden + 1;
      if r.nombre like 'TC %' then
        -- En una tarjeta el saldo es deuda: baja con el debe.
        insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
        values (v_asiento, v_orden, v_cuenta,
                'Saldo cero: la deuda pasó al refinanciamiento 00199574',
                greatest(-v_ajuste, 0), greatest(v_ajuste, 0));
        v_total := v_total - v_ajuste;
      else
        insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
        values (v_asiento, v_orden, v_cuenta,
                'Ajuste al saldo del banco del 21-22/10/2026 (' || to_char(r.objetivo, 'FM999G990D00') || ')',
                greatest(v_ajuste, 0), greatest(-v_ajuste, 0));
        v_total := v_total + v_ajuste;
      end if;
      v_cuenta := null;
    end if;
    v_cuenta := null;
  end loop;

  -- Préstamos: solo se contabilizan por asiento, no tienen pendiente.
  for r in
    select * from (values
      ('2.2.01.01', 17906.79, 'Saldo del préstamo según el Banco del Austro'),
      ('2.2.01.02',     0.00, 'Unificado en el refinanciamiento 00199574 (03/08/2026)'),
      ('2.2.01.03',     0.00, 'Unificado en el refinanciamiento 00199574 (03/08/2026)'),
      ('2.2.01.04',  7118.14, 'Saldo del préstamo según Mutualista Pichincha'),
      ('2.2.01.05', 27856.67, 'Capital pendiente del refinanciamiento 00199574')
    ) as t(codigo, objetivo, detalle)
  loop
    select p.id,
           coalesce(sum(l.haber - l.debe) filter (where a.estado = 'CONTABILIZADO'), 0)
      into v_cuenta, v_actual
      from public.plan_cuentas p
      left join public.asiento_lineas l on l.cuenta_id = p.id
      left join public.asientos a on a.id = l.asiento_id
     where p.entidad_id = v_ent and p.codigo = r.codigo
     group by p.id;
    v_ajuste := round(r.objetivo - v_actual, 2);
    if v_ajuste <> 0 then
      v_orden := v_orden + 1;
      insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
      values (v_asiento, v_orden, v_cuenta, r.detalle, greatest(-v_ajuste, 0), greatest(v_ajuste, 0));
      v_total := v_total - v_ajuste;
    end if;
  end loop;

  -- La diferencia, contra resultados acumulados.
  if v_total <> 0 then
    v_orden := v_orden + 1;
    insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
    values (v_asiento, v_orden, v_patrimonio,
            'Movimientos no cargados hasta el 21/10/2026',
            greatest(-v_total, 0), greatest(v_total, 0));
  end if;

  update public.asientos set estado = 'CONTABILIZADO' where id = v_asiento;
end $$;
