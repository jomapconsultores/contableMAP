-- ---------------------------------------------------------------------
-- Menaje de casa: 5.000 más
--
-- El titular valora el menaje de casa en 7.400 para la declaración de fin de
-- gestión (22/10/2026): 5.000 más que los 2.400 declarados en abril. Son
-- bienes que ya tenía y no se habían valorado, así que la contrapartida es
-- «Resultados acumulados», no un ingreso.
-- ---------------------------------------------------------------------

do $$
declare
  v_ent        uuid;
  v_asiento    uuid;
  v_menaje     uuid;
  v_patrimonio uuid;
begin
  select id into v_ent from public.entidades order by created_at limit 1;
  if v_ent is null then
    return;
  end if;
  select id into v_menaje from public.plan_cuentas where entidad_id = v_ent and codigo = '1.2.01.02';
  select id into v_patrimonio from public.plan_cuentas where entidad_id = v_ent and codigo = '3.2';
  if v_menaje is null then
    raise exception 'No existe la cuenta 1.2.01.02 Menaje de casa';
  end if;

  insert into public.asientos (entidad_id, fecha, glosa, tipo, origen, estado)
  values (v_ent, '2026-10-22', 'Menaje de casa valorado en 7.400 (0036)', 'DIARIO', 'MANUAL', 'BORRADOR')
  returning id into v_asiento;

  insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
  values (v_asiento, 1, v_menaje, 'Menaje no valorado hasta el 22/10/2026', 5000.00, 0),
         (v_asiento, 2, v_patrimonio, 'Menaje no valorado hasta el 22/10/2026', 0, 5000.00);

  update public.asientos set estado = 'CONTABILIZADO' where id = v_asiento;
end $$;
