-- ---------------------------------------------------------------------
-- Una categoría por cosa, y cada una en una cuenta que admita asientos
--
-- 1) Siete categorías apuntaban a cuentas de agrupación —6.1.14 desde que se
--    desglosó en internet, software y celular; 6.9 desde que se separaron
--    donaciones y veterinaria—. Un movimiento clasificado en cualquiera de
--    ellas no se podía contabilizar: el trigger de líneas rechaza las cuentas
--    que no son de movimiento. Todavía no había ninguno, pero el mapa guardaba
--    67 reglas que llevaban ahí.
--
-- 2) Categorías que se pisaban, y con ellas la IA elegía a suertes:
--    CELULAR y RECARGA CELULAR contra TELEFONÍA CELULAR; SERVICIOS BÁSICOS y
--    ALUMBRADO ELÉCTRICO contra VIVIENDA; GAS, que se leía como gasolina.
--
-- 3) Deducibilidad, según el uso que confirma el titular:
--    · Trabaja desde casa: luz, agua y servicios básicos son vivienda, gasto
--      personal, no gasto del negocio.
--    · Celular e internet son principalmente de trabajo: siguen deducibles.
--    · Streaming, TV cable y gas doméstico son del hogar: no deducibles.
--    · Seguros de las tarjetas: los que protegen la deuda (desgravamen,
--      tarjeta protegida, cobranza) son coste de la financiación y van a
--      gastos financieros; renta hospitalaria y garantía extendida son
--      personales y no deducibles.
--
-- Como en 0024, un movimiento contabilizado se corrige también en su asiento.
-- ---------------------------------------------------------------------

do $$
declare
  v_ent uuid;
  r     record;
begin
  select id into v_ent from public.entidades order by created_at limit 1;
  if v_ent is null then
    return;
  end if;

  -- 1. Cuentas hoja que faltaban
  for r in
    select * from (values
      ('6.1.14.04', 'Firmas electrónicas',       '6.1.14'),
      ('6.2.03',    'Seguros de la deuda',       '6.2'),
      ('6.9.03',    'Gastos del hogar',          '6.9'),
      ('6.9.04',    'Seguros personales',        '6.9'),
      ('6.9.99',    'Otros gastos no deducibles', '6.9')
    ) as t(codigo, nombre, padre)
  loop
    insert into public.plan_cuentas
      (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
    select v_ent, r.codigo, r.nombre, p.tipo, p.subtipo, p.naturaleza, p.id, p.nivel + 1, true
      from public.plan_cuentas p
     where p.entidad_id = v_ent and p.codigo = r.padre
    on conflict (entidad_id, codigo) do nothing;
  end loop;

  -- 2. Categorías nuevas y categorías que cambian de cuenta o de trato
  insert into public.categorias_gasto (entidad_id, nombre, cuenta_id, deducible_negocio, credito_iva)
  select v_ent, 'SEGURO DE DESGRAVAMEN', id, true, false
    from public.plan_cuentas where entidad_id = v_ent and codigo = '6.2.03'
  on conflict (entidad_id, nombre) do nothing;

  insert into public.categorias_gasto (entidad_id, nombre, cuenta_id, deducible_negocio, credito_iva)
  select v_ent, 'SEGURO PERSONAL', id, false, false
    from public.plan_cuentas where entidad_id = v_ent and codigo = '6.9.04'
  on conflict (entidad_id, nombre) do nothing;

  update public.categorias_gasto
     set nombre = 'GAS DOMÉSTICO'
   where entidad_id = v_ent and nombre = 'GAS';

  for r in
    select * from (values
      ('FIRMAS ELECTRÓNICAS', '6.1.14.04', true,  true),
      ('STREAMING',           '6.9.03',    false, false),
      ('TELEVISIÓN CABLE',    '6.9.03',    false, false),
      ('GAS DOMÉSTICO',       '6.9.03',    false, false),
      ('COSMÉTICOS',          '6.9.99',    false, false),
      ('LICORES',             '6.9.99',    false, false)
    ) as t(nombre, codigo, deducible, iva)
  loop
    update public.categorias_gasto c
       set cuenta_id = p.id, deducible_negocio = r.deducible, credito_iva = r.iva
      from public.plan_cuentas p
     where c.entidad_id = v_ent and c.nombre = r.nombre
       and p.entidad_id = v_ent and p.codigo = r.codigo;
  end loop;

  -- 3. Qué movimiento cambia de categoría: los de las categorías que se
  --    fusionan y los seguros que se separan.
  create temp table _destino on commit drop as
  select c.id as cat_origen, n.id as cat_destino
    from (values
      ('CELULAR',                      'TELEFONÍA CELULAR'),
      ('RECARGA CELULAR',              'TELEFONÍA CELULAR'),
      ('SERVICIOS BÁSICOS',            'VIVIENDA'),
      ('SERVICIO ALUMBRADO ELÉCTRICO', 'VIVIENDA')
    ) as t(origen, destino)
    join public.categorias_gasto c on c.entidad_id = v_ent and c.nombre = t.origen
    join public.categorias_gasto n on n.entidad_id = v_ent and n.nombre = t.destino;

  create temp table _reclas on commit drop as
  select m.id, m.asiento_id, c.cuenta_id as cuenta_vieja,
         n.id as cat_nueva, n.cuenta_id as cuenta_nueva
    from public.movimientos_extracto m
    join public.categorias_gasto c on c.id = m.categoria_id
    left join _destino d on d.cat_origen = m.categoria_id
    left join public.categorias_gasto n on n.entidad_id = v_ent and n.nombre =
      case
        when d.cat_destino is not null then (select nombre from public.categorias_gasto where id = d.cat_destino)
        when c.nombre = 'SEGUROS' and m.descripcion ~* 'RENTA HOSPITAL|GARANT' then 'SEGURO PERSONAL'
        when c.nombre = 'SEGUROS'
         and m.descripcion ~* 'DESGRAVAMEN|DEUDA ASEGURADA|TARJETA PROTEGIDA|PROTECCION EXPRESS|COBRANZA'
          then 'SEGURO DE DESGRAVAMEN'
      end
   where m.entidad_id = v_ent
     and n.id is not null
     and n.id <> m.categoria_id;

  update public.asiento_lineas l
     set cuenta_id = x.cuenta_nueva
    from _reclas x
   where l.asiento_id = x.asiento_id
     and l.cuenta_id = x.cuenta_vieja
     and x.cuenta_nueva is distinct from x.cuenta_vieja;

  update public.movimientos_extracto m
     set categoria_id = x.cat_nueva, clasificado_por = 'MANUAL', confianza_ia = null
    from _reclas x
   where m.id = x.id;

  -- Lo que los seguros enseñan al mapa
  insert into public.mapa_clasificacion
    (entidad_id, tipo_clave, clave, nombre_origen, categoria_id, origen, confirmado)
  select distinct on (m.comercio)
         v_ent, 'COMERCIO', m.comercio, m.descripcion, m.categoria_id, 'MANUAL', true
    from public.movimientos_extracto m
    join _reclas x on x.id = m.id
   where m.comercio is not null
  on conflict (entidad_id, tipo_clave, clave) do update
     set categoria_id = excluded.categoria_id, origen = 'MANUAL', confirmado = true;

  -- 4. Las categorías fusionadas entregan sus reglas y sus compras antes de
  --    desaparecer: el mapa se borra en cascada con la categoría.
  update public.mapa_clasificacion m
     set categoria_id = d.cat_destino
    from _destino d
   where m.categoria_id = d.cat_origen;

  update public.compras cm
     set categoria_id = d.cat_destino
    from _destino d
   where cm.categoria_id = d.cat_origen;

  delete from public.categorias_gasto c
   using _destino d
   where c.id = d.cat_origen;
end $$;
