-- ---------------------------------------------------------------------
-- La 4547 es la Titanium, y la Discover necesita su propia cuenta
--
-- Diners Club del Ecuador emite tres tarjetas a nombre del titular, cada una
-- con su estado de cuenta y su corte:
--
--   Diners Club   DCDN…8834   corte día 15   → ya tenía su cuenta
--   Visa Titanium IDMC…4547   corte fin de mes
--   Discover      DCDI…9645   corte día 3
--
-- La cuenta de la 4547 se había dado de alta como «TC Discover Interdín». El
-- número es el de la Titanium, así que es la Titanium la que lleva ese nombre
-- equivocado, y la Discover no tenía dónde cargarse. Ninguna de las dos tenía
-- todavía movimientos ni asientos: basta con renombrar una y crear la otra.
-- ---------------------------------------------------------------------

do $$
declare
  v_ent   uuid;
  v_padre record;
  v_plan  uuid;
begin
  select id into v_ent from public.entidades order by created_at limit 1;
  if v_ent is null then
    return;
  end if;

  -- 1. La 4547 se llama por lo que es
  update public.plan_cuentas p
     set nombre = 'Visa Titanium Diners'
    from public.cuentas_financieras cf
   where cf.cuenta_id = p.id
     and cf.entidad_id = v_ent
     and cf.numero = '****4547'
     and p.nombre = 'Discover Interdín';

  update public.cuentas_financieras
     set nombre = 'TC Visa Titanium Diners'
   where entidad_id = v_ent
     and numero = '****4547'
     and nombre = 'TC Discover Interdín';

  -- 2. La Discover, con su cuenta contable junto a las demás tarjetas
  select * into v_padre from public.plan_cuentas
   where entidad_id = v_ent and codigo = '2.1.03';

  insert into public.plan_cuentas
    (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
  values (v_ent, '2.1.03.10', 'Discover Diners',
          'PASIVO', 'CORRIENTE', 'C', v_padre.id, v_padre.nivel + 1, true)
  on conflict (entidad_id, codigo) do nothing;

  select id into v_plan from public.plan_cuentas
   where entidad_id = v_ent and codigo = '2.1.03.10';

  insert into public.cuentas_financieras
    (entidad_id, nombre, tipo, institucion, numero, cuenta_id, dia_corte)
  values (v_ent, 'TC Discover Diners', 'TARJETA_CREDITO',
          'Banco Diners Club del Ecuador S.A.', '****9645', v_plan, 3)
  on conflict (entidad_id, nombre) do nothing;
end $$;
