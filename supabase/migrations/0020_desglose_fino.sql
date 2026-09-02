-- ---------------------------------------------------------------------
-- Desglose hasta el último renglón
--
-- Quedaban cuentas que seguían siendo un solo importe con varias cosas dentro:
-- «Propiedad, planta y equipo» juntaba el equipo de oficina, el menaje y las
-- joyas; «Otras cuentas por cobrar» sumaba a tres deudores distintos; y cuatro
-- cuentas de gasto mezclaban categorías que no se parecen —gasolina con diésel,
-- software con telefonía, donaciones con veterinaria—.
--
-- Cada una recibe ahora su subcuenta, con el mismo criterio que se usó con las
-- tarjetas y las libretas: la cuenta madre agrupa, y el detalle vive debajo.
--
-- El asiento de cierre de 2025 se reparte con ellas. Sus importes cuadran al
-- céntimo con los gastos de 2025 de cada categoría, así que el reparto no
-- aproxima nada: 73,46 de combustible son 36,23 de gasolina y 37,23 de diésel.
-- ---------------------------------------------------------------------

do $$
declare
  v_ent     uuid;
  v_padre   record;
  v_sub     uuid;
  v_cod     text;
  v_n       int;
  v_orden   int;
  v_importe numeric(16,2);
  v_asiento uuid;
  v_cuenta  uuid;
  r         record;
begin
  select id into v_ent from public.entidades order by created_at limit 1;
  if v_ent is null then
    return;
  end if;

  -- ------------------------------------------------------------------
  -- 1. Los bienes, uno por uno
  -- ------------------------------------------------------------------
  select * into v_padre from public.plan_cuentas
   where entidad_id = v_ent and codigo = '1.2.01';

  for r in
    select * from (values
      ('1.2.01.01', 'Equipo de oficina'),
      ('1.2.01.02', 'Menaje de casa'),
      ('1.2.01.03', 'Obras de arte, joyas y colecciones')
    ) as t(codigo, nombre)
  loop
    insert into public.plan_cuentas
      (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
    values (v_ent, r.codigo, r.nombre, v_padre.tipo, v_padre.subtipo, v_padre.naturaleza,
            v_padre.id, v_padre.nivel + 1, true)
    on conflict (entidad_id, codigo) do nothing;

    -- Cada línea del asiento patrimonial lleva el nombre del bien en el detalle.
    update public.asiento_lineas l
       set cuenta_id = (select id from public.plan_cuentas
                         where entidad_id = v_ent and codigo = r.codigo)
     where l.cuenta_id = v_padre.id
       and l.detalle = r.nombre;
  end loop;

  -- Lo demás que cuelgue de aquí es equipo: la compra de agosto en Comercial
  -- Benavides entró por extracto, sin más detalle que el nombre del comercio.
  update public.asiento_lineas l
     set cuenta_id = (select id from public.plan_cuentas
                       where entidad_id = v_ent and codigo = '1.2.01.01')
   where l.cuenta_id = v_padre.id;

  update public.plan_cuentas set es_movimiento = false where id = v_padre.id;

  -- ------------------------------------------------------------------
  -- 2. Un deudor, una cuenta
  -- ------------------------------------------------------------------
  select * into v_padre from public.plan_cuentas
   where entidad_id = v_ent and codigo = '1.1.02.03';

  v_n := 0;
  for r in
    select distinct t.id, t.razon_social
      from public.asiento_lineas l
      join public.terceros t on t.id = l.tercero_id
     where l.cuenta_id = v_padre.id
     order by t.razon_social
  loop
    v_n := v_n + 1;
    v_cod := '1.1.02.03.' || lpad(v_n::text, 2, '0');

    insert into public.plan_cuentas
      (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
    values (v_ent, v_cod, left(r.razon_social, 60), v_padre.tipo, v_padre.subtipo,
            v_padre.naturaleza, v_padre.id, v_padre.nivel + 1, true)
    on conflict (entidad_id, codigo) do nothing;

    update public.asiento_lineas l
       set cuenta_id = (select id from public.plan_cuentas
                         where entidad_id = v_ent and codigo = v_cod)
     where l.cuenta_id = v_padre.id
       and l.tercero_id = r.id;
  end loop;

  if v_n > 0 then
    update public.plan_cuentas set es_movimiento = false where id = v_padre.id;
  end if;

  -- ------------------------------------------------------------------
  -- 3. Los gastos, por categoría
  --
  -- Solo se parten las cuentas donde conviven dos o más categorías con
  -- movimientos: si una cuenta tiene una sola, ya está diciendo lo que es.
  -- ------------------------------------------------------------------
  for v_padre in
    select p.*
      from public.plan_cuentas p
     where p.entidad_id = v_ent
       and p.es_movimiento
       and p.tipo in ('GASTO', 'COSTO', 'INGRESO')
       and (select count(distinct m.categoria_id)
              from public.movimientos_extracto m
             where m.entidad_id = v_ent
               and m.categoria_id in (select id from public.categorias_gasto
                                       where entidad_id = v_ent and cuenta_id = p.id)) > 1
     order by p.codigo
  loop
    v_n := 0;
    for r in
      select c.id, c.nombre
        from public.categorias_gasto c
       where c.entidad_id = v_ent and c.cuenta_id = v_padre.id
         and exists (select 1 from public.movimientos_extracto m where m.categoria_id = c.id)
       order by c.nombre
    loop
      v_n := v_n + 1;
      v_cod := v_padre.codigo || '.' || lpad(v_n::text, 2, '0');

      insert into public.plan_cuentas
        (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
      values (v_ent, v_cod,
              upper(left(r.nombre, 1)) || lower(substr(r.nombre, 2)),
              v_padre.tipo, v_padre.subtipo, v_padre.naturaleza,
              v_padre.id, v_padre.nivel + 1, true)
      on conflict (entidad_id, codigo) do nothing;

      select id into v_sub from public.plan_cuentas
       where entidad_id = v_ent and codigo = v_cod;

      -- Lo ya registrado se muda con su movimiento.
      update public.asiento_lineas l
         set cuenta_id = v_sub
        from public.asientos a
        join public.movimientos_extracto m on m.id = a.origen_id
       where a.id = l.asiento_id
         and a.origen = 'EXTRACTO'
         and m.categoria_id = r.id
         and l.cuenta_id = v_padre.id;

      -- Y el cierre de 2025 se reparte igual, con lo que gastó cada categoría.
      for v_asiento in
        select distinct a.id
          from public.asiento_lineas l
          join public.asientos a on a.id = l.asiento_id
         where l.cuenta_id = v_padre.id and a.origen = 'CIERRE'
      loop
        select coalesce(sum(l.debe - l.haber), 0) into v_importe
          from public.asiento_lineas l
          join public.asientos a on a.id = l.asiento_id
          join public.movimientos_extracto m on m.id = a.origen_id
         where l.cuenta_id = v_sub
           and a.origen = 'EXTRACTO'
           and m.fecha < '2026-01-01';

        if v_importe <> 0 then
          insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
          select v_asiento,
                 (select coalesce(max(orden), 0) + 1 from public.asiento_lineas
                   where asiento_id = v_asiento),
                 v_sub, 'Cierre 2025 · ' || r.nombre, 0, v_importe;
        end if;
      end loop;

      -- La categoría apunta ya a su cuenta: lo próximo que llegue no vuelve
      -- a caer en la madre, que a partir de ahora solo agrupa.
      update public.categorias_gasto set cuenta_id = v_sub where id = r.id;
    end loop;

    -- La línea de cierre que resumía toda la cuenta ya está repartida.
    delete from public.asiento_lineas l
     using public.asientos a
     where a.id = l.asiento_id
       and a.origen = 'CIERRE'
       and l.cuenta_id = v_padre.id;

    update public.plan_cuentas set es_movimiento = false where id = v_padre.id;
  end loop;

  -- ------------------------------------------------------------------
  -- 4. Crédito FAVORITO: el total a pagar, no la cuota del mes
  --
  -- El estado de cuenta de marzo cierra en 26,32, que es lo que tocaba pagar
  -- ese mes. Detrás quedaban tres compras a plazo vivas —Megamaxi en cuota
  -- 17 de 30 y en 10 de 15, y la garantía total en 10 de 15—, que suman 249,00
  -- todavía por pagar. El mismo cálculo aplicado a Diners devuelve sus 7.134,60
  -- al céntimo, que es el valor que su propio extracto declara.
  -- ------------------------------------------------------------------
  if not exists (
    select 1 from public.asientos
     where entidad_id = v_ent and glosa like 'Compras a plazo pendientes de Cr%')
  then
    insert into public.asientos (entidad_id, fecha, glosa, tipo, origen, origen_id, estado)
    values (v_ent, '2026-03-01',
            'Compras a plazo pendientes de Crédito FAVORITO, fuera del total del mes',
            'DIARIO', 'MANUAL', null, 'BORRADOR')
    returning id into v_asiento;

    select cf.cuenta_id into v_cuenta from public.cuentas_financieras cf
     where cf.entidad_id = v_ent and cf.nombre = 'Crédito FAVORITO';

    insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
    values (v_asiento, 1, v_cuenta,
            'Megamaxi 13 cuotas de 16,60 · Megamaxi 5 de 5,64 · Garantía total 5 de 1,00',
            0, 249.00);

    select id into v_cuenta from public.plan_cuentas
     where entidad_id = v_ent and codigo = '3.2';

    insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
    values (v_asiento, 2, v_cuenta, 'Deuda a plazo anterior no registrada', 249.00, 0);

    update public.asientos set estado = 'CONTABILIZADO' where id = v_asiento;
  end if;
end $$;
