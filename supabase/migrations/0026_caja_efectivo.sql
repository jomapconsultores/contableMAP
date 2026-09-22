-- ---------------------------------------------------------------------
-- El efectivo también es una cuenta
--
-- Los gastos pagados en efectivo —parqueaderos, taxis, propinas, comida en la
-- calle— el titular los dicta a una lista de Microsoft To Do. Para que entren
-- en la contabilidad necesitan una cuenta de donde salir: Caja.
--
-- Y Caja necesita de dónde llenarse. Los retiros en cajero y los depósitos de
-- efectivo de la cooperativa estaban como «traspaso entre cuentas», contra una
-- cuenta puente que nadie cerraba del otro lado. Ahora van contra Caja: el
-- retiro la llena, el depósito la vacía, y lo que se gasta en efectivo se
-- descuenta de lo que se retiró.
--
-- Categorías nuevas para lo que el efectivo trae y no tenía dónde ir:
--   · PROPINAS Y COLABORACIONES: ayuda con las compras, cuotas en el trabajo.
--     Gasto personal, no deducible.
--   · JUEGOS Y RIFAS: pozo millonario, rifas. No deducible.
--   · PRÉSTAMO OTORGADO: dinero prestado a un tercero. No es gasto: es una
--     cuenta por cobrar.
-- ---------------------------------------------------------------------

do $$
declare
  v_ent  uuid;
  v_caja uuid;
  v_pad  record;
begin
  select id into v_ent from public.entidades order by created_at limit 1;
  if v_ent is null then
    return;
  end if;

  -- 1. La caja. El trigger de cuentas financieras le da su subcuenta propia
  --    bajo 1.1.01.01, que desde ese momento solo agrupa.
  insert into public.cuentas_financieras (entidad_id, nombre, tipo, institucion)
  values (v_ent, 'Caja - Efectivo', 'CAJA', 'Efectivo')
  on conflict (entidad_id, nombre) do nothing;

  select cuenta_id into v_caja from public.cuentas_financieras
   where entidad_id = v_ent and nombre = 'Caja - Efectivo';

  -- 2. Préstamos a terceros, junto a las demás cuentas por cobrar
  select * into v_pad from public.plan_cuentas
   where entidad_id = v_ent and codigo = '1.1.02.03';
  insert into public.plan_cuentas
    (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
  values (v_ent, '1.1.02.03.90', 'Préstamos personales otorgados',
          v_pad.tipo, v_pad.subtipo, v_pad.naturaleza, v_pad.id, v_pad.nivel + 1, true)
  on conflict (entidad_id, codigo) do nothing;

  -- 3. Categorías
  insert into public.categorias_gasto (entidad_id, nombre, cuenta_id, deducible_negocio, credito_iva)
  select v_ent, t.nombre, p.id, false, false
    from (values
      ('EFECTIVO (RETIRO O DEPÓSITO)', null::text),
      ('PROPINAS Y COLABORACIONES',   '6.9.99'),
      ('JUEGOS Y RIFAS',              '6.9.99'),
      ('PRÉSTAMO OTORGADO',           '1.1.02.03.90')
    ) as t(nombre, codigo)
    join public.plan_cuentas p
      on p.entidad_id = v_ent
     and (p.id = v_caja and t.codigo is null or p.codigo = t.codigo)
  on conflict (entidad_id, nombre) do nothing;

  -- 4. Retiros y depósitos de efectivo: de la cuenta puente a Caja, en el
  --    movimiento y en su asiento.
  create temp table _efectivo on commit drop as
  select m.id, m.asiento_id, c.cuenta_id as cuenta_vieja, n.id as cat_nueva
    from public.movimientos_extracto m
    join public.categorias_gasto c on c.id = m.categoria_id
    join public.categorias_gasto n
      on n.entidad_id = v_ent and n.nombre = 'EFECTIVO (RETIRO O DEPÓSITO)'
   where m.entidad_id = v_ent
     and c.nombre = 'TRASPASO ENTRE CUENTAS'
     and m.descripcion ~* '^TRX (POR DEBITO DE RETIRO|PARA DEPOSITO EN ATM)';

  update public.asiento_lineas l
     set cuenta_id = v_caja
    from _efectivo e
   where l.asiento_id = e.asiento_id
     and l.cuenta_id = e.cuenta_vieja;

  update public.movimientos_extracto m
     set categoria_id = e.cat_nueva, clasificado_por = 'MANUAL', confianza_ia = null
    from _efectivo e
   where m.id = e.id;
end $$;
