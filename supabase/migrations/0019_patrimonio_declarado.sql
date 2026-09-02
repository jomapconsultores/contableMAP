-- ---------------------------------------------------------------------
-- Lo que faltaba del balance, según la declaración juramentada
--
-- La declaración patrimonial 031-CGE presentada a la Contraloría el 15 de abril
-- de 2026 es la única foto completa que existe del patrimonio: activos 91.810,37,
-- pasivos 91.747,85, patrimonio 62,52. Contra ella, la contabilidad tenía medio
-- balance sin registrar —ni los préstamos personales, ni las cuentas por cobrar,
-- ni los bienes muebles— y por eso el patrimonio salía en −27.911,25.
--
-- Todo entra con la fecha del dato que lo respalda, no con la de hoy:
--   · 15/04/2026 lo que declara la Contraloría;
--   · 15/08/2026 el saldo diferido de Diners, que es el último corte que lo dice.
--
-- La contrapartida siempre es «Resultados acumulados»: son saldos que ya
-- existían y nunca se registraron, no ingresos ni gastos del ejercicio. Llevarlos
-- a resultados inflaría el año en curso con patrimonio viejo.
-- ---------------------------------------------------------------------

do $$
declare
  v_ent      uuid;
  v_asiento  uuid;
  v_orden    int := 0;
  v_cuenta   uuid;
  v_tercero  uuid;
  v_total    numeric(16,2) := 0;
  r          record;
begin
  select id into v_ent from public.entidades order by created_at limit 1;
  if v_ent is null then
    return;
  end if;

  -- ------------------------------------------------------------------
  -- 1. Las dos tarjetas que no estaban en el sistema
  --
  -- El trigger de cuentas_financieras les da su cuenta contable propia bajo
  -- «2.1.03 Tarjetas de crédito por pagar», como a las demás.
  -- ------------------------------------------------------------------
  insert into public.cuentas_financieras (entidad_id, nombre, tipo, institucion)
  values (v_ent, 'TC Coral Card', 'TARJETA_CREDITO', 'Coral Card')
  on conflict (entidad_id, nombre) do nothing;

  insert into public.cuentas_financieras (entidad_id, nombre, tipo, institucion)
  values (v_ent, 'TC Sukasa', 'TARJETA_CREDITO', 'Sukasa')
  on conflict (entidad_id, nombre) do nothing;

  -- ------------------------------------------------------------------
  -- 2. Un préstamo, una cuenta: el pasivo no corriente estaba vacío
  -- ------------------------------------------------------------------
  for r in
    select * from (values
      ('2.2.01.01', 'Banco del Austro · préstamo personal',      18900.00),
      ('2.2.01.02', 'Banco Guayaquil · préstamo personal 2024',  17481.22),
      ('2.2.01.03', 'Banco Guayaquil · préstamo personal 2025',   6630.00),
      ('2.2.01.04', 'Mutualista Pichincha · préstamo personal',   9424.25)
    ) as t(codigo, nombre, saldo)
  loop
    insert into public.plan_cuentas
      (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
    select v_ent, r.codigo, r.nombre, p.tipo, p.subtipo, p.naturaleza, p.id, p.nivel + 1, true
      from public.plan_cuentas p
     where p.entidad_id = v_ent and p.codigo = '2.2.01'
    on conflict (entidad_id, codigo) do nothing;
  end loop;

  -- «2.2.01» pasa a agrupar, igual que las demás familias con subcuentas.
  update public.plan_cuentas
     set es_movimiento = false
   where entidad_id = v_ent and codigo = '2.2.01'
     and exists (select 1 from public.plan_cuentas h where h.padre_id = plan_cuentas.id);

  -- ------------------------------------------------------------------
  -- 3. Los deudores, como terceros con nombre y cédula
  -- ------------------------------------------------------------------
  for r in
    select * from (values
      ('1705899894', 'SAN MARTÍN VILLALÓN EDELMIRA ANGÉLICA'),
      ('1702086305', 'POSLIGUA MONTÚFAR CARLOS RAÚL'),
      ('0302008776', 'NIEVECELA LEMA JOHANNA MARICELA')
    ) as t(cedula, nombre)
  loop
    insert into public.terceros
      (entidad_id, tipo_identificacion, identificacion, razon_social, es_cliente)
    values (v_ent, 'CEDULA', r.cedula, r.nombre, true)
    on conflict do nothing;
  end loop;

  -- ------------------------------------------------------------------
  -- 4. El asiento de la declaración, al 15/04/2026
  -- ------------------------------------------------------------------
  if not exists (
    select 1 from public.asientos
     where entidad_id = v_ent
       and glosa like 'Situación patrimonial declarada%')
  then
    insert into public.asientos (entidad_id, fecha, glosa, tipo, origen, origen_id, estado)
    values (v_ent, '2026-04-15',
            'Situación patrimonial declarada a la Contraloría (031-CGE) al 15/04/2026',
            'DIARIO', 'MANUAL', null, 'BORRADOR')
    returning id into v_asiento;

    -- 4.1 Bienes muebles (F.1.7.2)
    select id into v_cuenta from public.plan_cuentas
     where entidad_id = v_ent and codigo = '1.2.01';
    for r in
      select * from (values
        ('Equipo de oficina',                 8920.00),
        ('Menaje de casa',                    2400.00),
        ('Obras de arte, joyas y colecciones', 2386.00)
      ) as t(detalle, valor)
    loop
      v_orden := v_orden + 1;
      insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
      values (v_asiento, v_orden, v_cuenta, r.detalle, r.valor, 0);
      v_total := v_total + r.valor;
    end loop;

    -- 4.2 Cuentas por cobrar (F.1.5)
    select id into v_cuenta from public.plan_cuentas
     where entidad_id = v_ent and codigo = '1.1.02.03';
    for r in
      select * from (values
        ('1705899894', 'Préstamo personal',                   468.00),
        ('1702086305', 'Venta de vehículo pendiente de cobro', 15000.00),
        ('0302008776', 'Préstamo personal',                  53792.99)
      ) as t(cedula, detalle, valor)
    loop
      select id into v_tercero from public.terceros
       where entidad_id = v_ent and identificacion = r.cedula;
      v_orden := v_orden + 1;
      insert into public.asiento_lineas
        (asiento_id, orden, cuenta_id, tercero_id, detalle, debe, haber)
      values (v_asiento, v_orden, v_cuenta, v_tercero, r.detalle, r.valor, 0);
      v_total := v_total + r.valor;
    end loop;

    -- 4.3 Préstamos personales (F.2.1)
    for r in
      select * from (values
        ('2.2.01.01', 18900.00),
        ('2.2.01.02', 17481.22),
        ('2.2.01.03',  6630.00),
        ('2.2.01.04',  9424.25)
      ) as t(codigo, valor)
    loop
      select id into v_cuenta from public.plan_cuentas
       where entidad_id = v_ent and codigo = r.codigo;
      v_orden := v_orden + 1;
      insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
      values (v_asiento, v_orden, v_cuenta, 'Saldo declarado al 15/04/2026', 0, r.valor);
      v_total := v_total - r.valor;
    end loop;

    -- 4.4 Las dos tarjetas que faltaban, con su saldo declarado
    for r in
      select * from (values
        ('TC Coral Card', 160.37),
        ('TC Sukasa',     497.16)
      ) as t(nombre, valor)
    loop
      select cf.cuenta_id into v_cuenta from public.cuentas_financieras cf
       where cf.entidad_id = v_ent and cf.nombre = r.nombre;
      v_orden := v_orden + 1;
      insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
      values (v_asiento, v_orden, v_cuenta, 'Saldo declarado al 15/04/2026', 0, r.valor);
      v_total := v_total - r.valor;
    end loop;

    -- 4.5 La diferencia va a patrimonio: son saldos de siempre, no del año.
    select id into v_cuenta from public.plan_cuentas
     where entidad_id = v_ent and codigo = '3.2';
    v_orden := v_orden + 1;
    insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
    values (v_asiento, v_orden, v_cuenta,
            'Patrimonio anterior no registrado · declaración 031-CGE',
            greatest(-v_total, 0), greatest(v_total, 0));

    update public.asientos set estado = 'CONTABILIZADO' where id = v_asiento;
  end if;

  -- ------------------------------------------------------------------
  -- 5. El diferido de Diners, al 15/08/2026
  --
  -- Los extractos traen solo el consumo del mes: la propia extracción avisa de
  -- que el «SALDO DIFERIDO» queda fuera porque no es del período. Por eso la
  -- tarjeta mostraba 248,62 cuando la deuda real pasa de siete mil. El último
  -- corte cargado cifra ese pendiente en 7.134,60 (cuota 27 de 60).
  -- ------------------------------------------------------------------
  if not exists (
    select 1 from public.asientos
     where entidad_id = v_ent
       and glosa like 'Saldo diferido de Diners%')
  then
    insert into public.asientos (entidad_id, fecha, glosa, tipo, origen, origen_id, estado)
    values (v_ent, '2026-08-15',
            'Saldo diferido de Diners Club, fuera de los movimientos del extracto',
            'DIARIO', 'MANUAL', null, 'BORRADOR')
    returning id into v_asiento;

    select cf.cuenta_id into v_cuenta from public.cuentas_financieras cf
     where cf.entidad_id = v_ent and cf.nombre like '%Diners%';

    insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
    values (v_asiento, 1, v_cuenta, 'Saldo diferido pendiente al corte 15/08/2026', 0, 7134.60);

    select id into v_cuenta from public.plan_cuentas
     where entidad_id = v_ent and codigo = '3.2';
    insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
    values (v_asiento, 2, v_cuenta, 'Deuda diferida anterior no registrada', 7134.60, 0);

    update public.asientos set estado = 'CONTABILIZADO' where id = v_asiento;
  end if;
end $$;
