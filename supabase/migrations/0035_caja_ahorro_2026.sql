-- ---------------------------------------------------------------------
-- La caja es el ahorro en casa de 2026, no el histórico
--
-- La 0034 dejó la caja en el total histórico de «AHORRO: casa» (1.557,44).
-- El titular corrige: el efectivo es lo ahorrado en 2026, 413,85. Se ajusta
-- con el mismo criterio (contabilizado + pendiente) contra resultados
-- acumulados.
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

  v_ajuste := round(413.85 - v_actual, 2);
  if v_ajuste = 0 then
    return;
  end if;

  insert into public.asientos (entidad_id, fecha, glosa, tipo, origen, estado)
  values (v_ent, '2026-10-22',
          'Caja al ahorro en casa de 2026 según HabitNow (0035)',
          'DIARIO', 'MANUAL', 'BORRADOR')
  returning id into v_asiento;

  insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
  values (v_asiento, 1, v_caja, 'Ahorro en casa de 2026 (413,85)',
          greatest(v_ajuste, 0), greatest(-v_ajuste, 0)),
         (v_asiento, 2, v_patrimonio, 'Corrige la 0034: el efectivo es el ahorro de 2026',
          greatest(-v_ajuste, 0), greatest(v_ajuste, 0));

  update public.asientos set estado = 'CONTABILIZADO' where id = v_asiento;
end $$;
