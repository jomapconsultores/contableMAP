-- ---------------------------------------------------------------------
-- La caja es el ahorro en casa que lleva HabitNow
--
-- El titular anota en HabitNow, hábito «AHORRO: casa», el efectivo que guarda
-- en casa: 1.557,44 en total al 22/10/2026 (413,85 en 2026). Nunca había
-- entrado en ContableMAP; la caja solo tenía los gastos en efectivo dictados a
-- To Do, y daba −60,35 contando lo pendiente.
--
-- Por decisión del titular, ese ahorro es el saldo de «Caja - Efectivo». Con
-- el criterio de la 0030, el ajuste se calcula contra «contabilizado +
-- pendiente», para que al contabilizar los gastos ya cargados la caja quede en
-- 1.557,44. La contrapartida es «Resultados acumulados»: es dinero guardado a
-- lo largo de años, no un ingreso de este mes.
-- ---------------------------------------------------------------------

do $$
declare
  v_ent        uuid;
  v_asiento    uuid;
  v_caja       uuid;
  v_patrimonio uuid;
  v_actual     numeric(16,2);
  v_ajuste     numeric(16,2);
begin
  select id into v_ent from public.entidades order by created_at limit 1;
  if v_ent is null then
    return;
  end if;
  select id into v_patrimonio from public.plan_cuentas where entidad_id = v_ent and codigo = '3.2';

  select s.saldo + s.pendiente, cf.cuenta_id into v_actual, v_caja
    from public.fn_saldos_cuentas(v_ent, date '2026-10-22') s
    join public.cuentas_financieras cf on cf.id = s.cuenta_id
   where cf.nombre = 'Caja - Efectivo';
  if v_caja is null then
    raise exception 'No existe la cuenta Caja - Efectivo';
  end if;

  v_ajuste := round(1557.44 - v_actual, 2);
  if v_ajuste = 0 then
    return;
  end if;

  insert into public.asientos (entidad_id, fecha, glosa, tipo, origen, estado)
  values (v_ent, '2026-10-22',
          'Caja al ahorro en casa registrado en HabitNow (0034)',
          'DIARIO', 'MANUAL', 'BORRADOR')
  returning id into v_asiento;

  insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
  values (v_asiento, 1, v_caja, 'Ahorro en casa según HabitNow (1.557,44)',
          greatest(v_ajuste, 0), greatest(-v_ajuste, 0)),
         (v_asiento, 2, v_patrimonio, 'Ahorro en casa no registrado hasta el 22/10/2026',
          greatest(-v_ajuste, 0), greatest(v_ajuste, 0));

  update public.asientos set estado = 'CONTABILIZADO' where id = v_asiento;
end $$;
