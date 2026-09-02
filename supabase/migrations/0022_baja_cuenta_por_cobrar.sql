-- ---------------------------------------------------------------------
-- La deuda de Johanna Nievecela ya no existe
--
-- Entró con el asiento de la declaración juramentada, que la recogía en
-- 53.792,99 al 15 de abril. Ya no se debe, así que sale del activo. No se
-- registra un cobro —no hubo dinero entrando por ninguna cuenta— sino que se
-- corrige el propio asiento de arranque: era un saldo que no debía figurar.
--
-- El patrimonio baja en ese mismo importe, que es lo coherente: si el activo
-- nunca estuvo, el patrimonio de partida tampoco era el que se apuntó. La línea
-- de resultados acumulados de aquel asiento pasa de 29.873,99 al haber a
-- 23.919,00 al debe, y el asiento sigue cuadrando al céntimo.
-- ---------------------------------------------------------------------

do $$
declare
  v_ent      uuid;
  v_cuenta   uuid;
  v_asiento  uuid;
  v_importe  numeric(16,2);
  v_patrim   uuid;
  v_saldo    numeric(16,2);
begin
  select id into v_ent from public.entidades order by created_at limit 1;
  if v_ent is null then
    return;
  end if;

  select p.id into v_cuenta
    from public.plan_cuentas p
    join public.terceros t on t.entidad_id = p.entidad_id and t.identificacion = '0302008776'
   where p.entidad_id = v_ent
     and p.codigo like '1.1.02.03.%'
     and p.nombre = left(t.razon_social, 60);

  if v_cuenta is null then
    return;                       -- ya se dio de baja
  end if;

  -- Lo que aportó esa cuenta al asiento de la declaración.
  select l.asiento_id, sum(l.debe - l.haber)
    into v_asiento, v_importe
    from public.asiento_lineas l
    join public.asientos a on a.id = l.asiento_id
   where l.cuenta_id = v_cuenta
     and a.glosa like 'Situación patrimonial declarada%'
   group by l.asiento_id;

  if v_asiento is null then
    return;
  end if;

  delete from public.asiento_lineas where cuenta_id = v_cuenta;

  -- La contrapartida de patrimonio se reduce en el mismo importe, para que el
  -- asiento siga cuadrado sin inventar ningún otro movimiento.
  select id into v_patrim from public.plan_cuentas
   where entidad_id = v_ent and codigo = '3.2';

  select coalesce(sum(l.haber - l.debe), 0) into v_saldo
    from public.asiento_lineas l
   where l.asiento_id = v_asiento and l.cuenta_id = v_patrim;

  update public.asiento_lineas
     set debe  = greatest(v_importe - v_saldo, 0),
         haber = greatest(v_saldo - v_importe, 0),
         detalle = 'Patrimonio anterior no registrado · declaración 031-CGE'
   where asiento_id = v_asiento and cuenta_id = v_patrim;

  delete from public.plan_cuentas where id = v_cuenta;
end $$;
