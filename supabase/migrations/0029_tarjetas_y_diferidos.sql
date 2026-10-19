-- ---------------------------------------------------------------------
-- Las tarjetas, cuadradas contra su último estado de cuenta
--
-- Los movimientos de las tarjetas se recargaron el 22/09/2026 con los
-- extractos de octubre a diciembre de 2025 incluidos. Con eso quedaron mal
-- tres cosas que se habían calculado antes:
--
--   1. El cierre de 2025 abonaba 1.593,50 de gastos de 2025 que ya no tienen
--      asiento: los movimientos recargados aún no se contabilizan. Las
--      cuentas de gasto quedaban con saldo acreedor y el balance descuadraba
--      en esa cifra. Se anula. Desde la 0028 el balance recoge sin cierre el
--      resultado de los años anteriores.
--
--   2. Los saldos iniciales del 01/11/2025 descontaban los meses que todavía
--      no estaban cargados. Ahora que lo están, parte de la deuda contaba dos
--      veces: PacifiCard llevaba 2.358,73 de saldo inicial cuando su primer
--      extracto arranca en 348,08. Se rehacen con el criterio confirmado por
--      el titular: que cada tarjeta dé en libros el saldo de su último
--      extracto. Cada saldo va en dos líneas, para que se vea qué es dato y
--      qué es ajuste:
--        · el saldo anterior que imprime el primer extracto cargado;
--        · «Ajuste a último extracto»: los meses sin extracto y las líneas que
--          la lectura no recogió. Al cargar un extracto que falta, este ajuste
--          se tiene que reducir en lo que ese extracto traiga.
--
--   3. Los diferidos vivían dentro de la cuenta de la tarjeta, y cada cuota
--      mensual volvía a sumarse como deuda nueva. Pasan a «Diferidos de
--      tarjetas», una subcuenta por tarjeta: la cuota pasa del diferido al
--      rotativo y la deuda total no cambia.
--
-- Además, lo que la lectura dejó al revés en el Visa del Austro, comprobado
-- contra la aritmética del propio extracto:
--   · «PRECANCELACION DE DIFERIDO» (6.477,34, julio 2026) es un cargo: el saldo
--     del diferido viejo vuelve al rotativo. Leído como abono, el extracto de
--     agosto descuadraba en 12.954,68, el doble exacto.
--   · «PLAN DE AHORRO PROGRAMADO» es un cargo todos los meses. Los meses en que
--     se leyó como abono descuadran en el doble de su importe (marzo y junio:
--     70,00 = 2 × 35,00).
--
-- Y clasificaciones que contradecían lo ya decidido:
--   · Las cuotas de EfectivoÁgil entraban en Caja como si fueran retiros de
--     efectivo: son cuotas del avance diferido.
--   · El mapa mandaba la reprogramación de Diners a intereses y «cargos
--     capital anterior» de PacifiCard a deuda anterior, al revés de la 0024.
--   · El plan de ahorro programado iba como traspaso entre cuentas, pero su
--     otro lado no llega en ningún extracto: es un ahorro, un activo.
--
-- Crédito FAVORITO no se toca: sus extractos no cuadran ningún mes y hay que
-- revisarlos uno por uno antes de decidir qué es cuota y qué es pago.
-- ---------------------------------------------------------------------

do $$
declare
  v_ent        uuid;
  v_asiento    uuid;
  v_viejo      uuid;
  v_orden      int := 0;
  v_patrimonio uuid;
  v_total      numeric(16,2) := 0;
  v_dif        uuid;
  v_dif_diners uuid;
  v_dif_austro uuid;
  v_ahorro     uuid;
  v_cat_diners uuid;
  v_cat_austro uuid;
  v_cat_ahorro uuid;
  v_austro     uuid;
  v_diners     uuid;
  v_cuota      numeric(16,2);
  v_d0         numeric(16,2);
  r            record;
begin
  select id into v_ent from public.entidades order by created_at limit 1;
  if v_ent is null then
    return;
  end if;

  select id into v_patrimonio from public.plan_cuentas where entidad_id = v_ent and codigo = '3.2';
  select id into v_austro from public.cuentas_financieras
   where entidad_id = v_ent and nombre = 'TC Visa Banco del Austro';
  select id into v_diners from public.cuentas_financieras
   where entidad_id = v_ent and nombre = 'Banco Diners Club del Ecuador S.A. - 363189';
  if v_austro is null or v_diners is null then
    raise exception 'No se encontraron las tarjetas del Austro y de Diners';
  end if;

  -- ------------------------------------------------------------------
  -- 1. El cierre de 2025, anulado
  -- ------------------------------------------------------------------
  update public.asientos
     set estado = 'ANULADO',
         glosa = glosa || ' · anulado: los gastos que cerraba se recargaron sin asiento'
   where entidad_id = v_ent and origen = 'CIERRE' and fecha = '2025-12-31'
     and estado = 'CONTABILIZADO';

  -- ------------------------------------------------------------------
  -- 2. Lo que se leyó al revés en el Austro. La huella incluye la
  --    naturaleza, así que se recalcula con la fórmula de la 0015.
  -- ------------------------------------------------------------------
  update public.movimientos_extracto
     set naturaleza = 'DEBITO'
   where entidad_id = v_ent and cuenta_id = v_austro and naturaleza = 'CREDITO'
     and asiento_id is null
     and (descripcion ~* '^PRECANCELACION DE DIFERIDO' or descripcion ~* '^PLAN DE AHORRO PROGRAMADO');

  update public.movimientos_extracto
     set hash_linea = substr(encode(digest(
           fecha::text || '|' || upper(btrim(descripcion)) || '|' ||
           to_char(monto, 'FM9999999999990.00') || '|' || naturaleza || '|' ||
           coalesce(referencia, ''), 'sha256'), 'hex'), 1, 32)
   where entidad_id = v_ent and cuenta_id = v_austro
     and (descripcion ~* '^PRECANCELACION DE DIFERIDO' or descripcion ~* '^PLAN DE AHORRO PROGRAMADO');

  -- ------------------------------------------------------------------
  -- 3. Las cuentas nuevas y sus categorías
  -- ------------------------------------------------------------------
  insert into public.plan_cuentas
    (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
  select v_ent, '2.1.08', 'Diferidos de tarjetas', 'PASIVO', 'CORRIENTE', 'C', p.id, p.nivel + 1, false
    from public.plan_cuentas p where p.entidad_id = v_ent and p.codigo = '2.1'
  on conflict (entidad_id, codigo) do nothing;
  select id into v_dif from public.plan_cuentas where entidad_id = v_ent and codigo = '2.1.08';

  insert into public.plan_cuentas
    (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
  values
    (v_ent, '2.1.08.01', 'Diferido · Diners Club 363189', 'PASIVO', 'CORRIENTE', 'C', v_dif, 4, true),
    (v_ent, '2.1.08.02', 'Diferido · Visa Banco del Austro', 'PASIVO', 'CORRIENTE', 'C', v_dif, 4, true)
  on conflict (entidad_id, codigo) do nothing;
  select id into v_dif_diners from public.plan_cuentas where entidad_id = v_ent and codigo = '2.1.08.01';
  select id into v_dif_austro from public.plan_cuentas where entidad_id = v_ent and codigo = '2.1.08.02';

  insert into public.plan_cuentas
    (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
  select v_ent, '1.1.05', 'Plan de ahorro programado · Banco del Austro', 'ACTIVO', 'CORRIENTE', 'D',
         p.id, p.nivel + 1, true
    from public.plan_cuentas p where p.entidad_id = v_ent and p.codigo = '1.1'
  on conflict (entidad_id, codigo) do nothing;
  select id into v_ahorro from public.plan_cuentas where entidad_id = v_ent and codigo = '1.1.05';

  insert into public.categorias_gasto (entidad_id, nombre, cuenta_id, deducible_negocio, credito_iva)
  values (v_ent, 'DIFERIDO DINERS', v_dif_diners, false, false),
         (v_ent, 'DIFERIDO AUSTRO', v_dif_austro, false, false),
         (v_ent, 'PLAN DE AHORRO PROGRAMADO', v_ahorro, false, false)
  on conflict (entidad_id, nombre) do update set cuenta_id = excluded.cuenta_id;
  select id into v_cat_diners from public.categorias_gasto where entidad_id = v_ent and nombre = 'DIFERIDO DINERS';
  select id into v_cat_austro from public.categorias_gasto where entidad_id = v_ent and nombre = 'DIFERIDO AUSTRO';
  select id into v_cat_ahorro from public.categorias_gasto where entidad_id = v_ent and nombre = 'PLAN DE AHORRO PROGRAMADO';

  -- ------------------------------------------------------------------
  -- 4. Cada movimiento a su categoría. Ninguno tiene asiento todavía; si
  --    alguno lo tuviera, se deja: su corrección pasa por recategorizar.
  -- ------------------------------------------------------------------
  update public.movimientos_extracto m
     set categoria_id = v_cat_diners, clasificado_por = 'MANUAL', confianza_ia = null
   where m.entidad_id = v_ent and m.cuenta_id = v_diners and m.asiento_id is null
     and m.descripcion ~* '^REPROGRAMACI';

  update public.movimientos_extracto m
     set categoria_id = v_cat_austro, clasificado_por = 'MANUAL', confianza_ia = null
   where m.entidad_id = v_ent and m.cuenta_id = v_austro and m.asiento_id is null
     and m.descripcion ~* '^(EFECTIVOAGIL|PRECANCELACION DE DIFERIDO|TRANSF\.DEUDA ROTATIVO A DIFER|DIF\.ACUERDO ALIVIO)';

  update public.movimientos_extracto m
     set categoria_id = v_cat_ahorro, clasificado_por = 'MANUAL', confianza_ia = null
   where m.entidad_id = v_ent and m.cuenta_id = v_austro and m.asiento_id is null
     and m.descripcion ~* '^PLAN DE AHORRO PROGRAMADO';

  update public.movimientos_extracto m
     set categoria_id = c.id, clasificado_por = 'MANUAL', confianza_ia = null
    from public.categorias_gasto c
   where c.entidad_id = v_ent and c.nombre = 'RENDIMIENTOS FINANCIEROS'
     and m.entidad_id = v_ent and m.asiento_id is null
     and m.descripcion ~* '^NC INT\. PLAN AHORRO PROGRAMADO';

  -- El costo del avance y los cargos sobre capital anterior son interés.
  update public.movimientos_extracto m
     set categoria_id = c.id, clasificado_por = 'MANUAL', confianza_ia = null
    from public.categorias_gasto c
   where c.entidad_id = v_ent and c.nombre = 'INTERESES'
     and m.entidad_id = v_ent and m.asiento_id is null
     and (m.descripcion ~* '^COSTO AVANCE DIFERIDO' or m.descripcion ~* 'CARGOS CAPITAL ANTERIOR');

  -- Lo aprendido, para que los extractos que vengan no repitan el error.
  update public.mapa_clasificacion
     set categoria_id = v_cat_diners, origen = 'MANUAL', confirmado = true
   where entidad_id = v_ent and tipo_clave = 'COMERCIO' and clave ~ '^REPROGRAMACION';
  update public.mapa_clasificacion
     set categoria_id = v_cat_austro, origen = 'MANUAL', confirmado = true
   where entidad_id = v_ent and tipo_clave = 'COMERCIO'
     and clave in ('EFECTIVOAGIL', 'PRECANCELACION DE DIFERIDO');
  update public.mapa_clasificacion
     set categoria_id = v_cat_ahorro, origen = 'MANUAL', confirmado = true
   where entidad_id = v_ent and tipo_clave = 'COMERCIO'
     and clave in ('PLAN DE AHORRO', 'PLAN AHORRO PROGRAMADO');
  update public.mapa_clasificacion mc
     set categoria_id = c.id, origen = 'MANUAL', confirmado = true
    from public.categorias_gasto c
   where c.entidad_id = v_ent and c.nombre = 'INTERESES'
     and mc.entidad_id = v_ent and mc.tipo_clave = 'COMERCIO'
     and mc.clave in ('COSTO AVANCE DIFERIDO', 'CAPITAL ANTERIOR');

  -- ------------------------------------------------------------------
  -- 5. Los saldos iniciales, cuadrados al último extracto
  --
  -- Para cada tarjeta: saldo final en libros = saldo inicial + todos sus
  -- movimientos + lo que otros asientos le cargan. Se despeja el saldo
  -- inicial para que el final sea el saldo del último extracto.
  -- ------------------------------------------------------------------
  select id into v_viejo from public.asientos
   where entidad_id = v_ent and origen = 'MANUAL' and estado = 'CONTABILIZADO'
     and glosa like 'Saldos iniciales de las tarjetas de crédito%';

  -- El diferido de Diners del 15/08 se sustituye por el de arranque.
  update public.asientos
     set estado = 'ANULADO',
         glosa = glosa || ' · anulado: el diferido pasa a 2.1.08.01 (0029)'
   where entidad_id = v_ent and origen = 'MANUAL' and estado = 'CONTABILIZADO'
     and glosa like 'Saldo diferido de Diners%';

  insert into public.asientos (entidad_id, fecha, glosa, tipo, origen, estado)
  values (v_ent, '2025-09-28',
          'Saldos iniciales de las tarjetas, cuadrados al último extracto cargado (0029)',
          'APERTURA', 'MANUAL', 'BORRADOR')
  returning id into v_asiento;

  create temp table _saldos on commit drop as
  with docs as (
    select d.cuenta_id, d.periodo_hasta,
           (d.extraccion ->> 'saldo_anterior')::numeric as saldo_anterior,
           (d.extraccion ->> 'saldo_actual')::numeric   as saldo_actual,
           row_number() over (partition by d.cuenta_id order by d.periodo_hasta)      as primero,
           row_number() over (partition by d.cuenta_id order by d.periodo_hasta desc) as ultimo
      from public.documentos d
     where d.entidad_id = v_ent and d.estado = 'EXTRAIDO' and d.periodo_hasta is not null
  ),
  tarjetas as (
    select f.id, f.nombre, f.cuenta_id as plan_id
      from public.cuentas_financieras f
     where f.entidad_id = v_ent
       and f.nombre in ('Banco Diners Club del Ecuador S.A. - 363189',
                        'TC American Express Banco Guayaquil',
                        'TC PacifiCard Gold Banco Pacífico',
                        'TC Visa Banco del Austro',
                        'TC Mastercard Produbanco',
                        'TC Visa Titanium Diners',
                        'TC Discover Diners')
  )
  select t.id, t.nombre, t.plan_id,
         p.saldo_anterior as inicial,
         u.saldo_actual   as final,
         u.periodo_hasta  as fecha_final,
         -- En una tarjeta el cargo es deuda nueva.
         coalesce((select sum(case when m.naturaleza = 'DEBITO' then m.monto else -m.monto end)
                     from public.movimientos_extracto m
                    where m.cuenta_id = t.id), 0) as movimientos,
         -- Lo que otros asientos vivos ya cargan a la tarjeta, salvo el saldo
         -- inicial que se sustituye y los asientos de sus propios movimientos.
         coalesce((select sum(l.haber - l.debe)
                     from public.asiento_lineas l
                     join public.asientos a on a.id = l.asiento_id
                    where l.cuenta_id = t.plan_id
                      and a.estado = 'CONTABILIZADO'
                      and a.id is distinct from v_viejo
                      and not exists (select 1 from public.movimientos_extracto m
                                       where m.asiento_id = a.id and m.cuenta_id = t.id)), 0) as otros
    from tarjetas t
    join docs p on p.cuenta_id = t.id and p.primero = 1
    join docs u on u.cuenta_id = t.id and u.ultimo = 1;

  if (select count(*) from _saldos) <> 7 then
    raise exception 'Se esperaban 7 tarjetas con extractos y hay %', (select count(*) from _saldos);
  end if;

  for r in
    select s.*, round(s.final - s.movimientos - s.otros - s.inicial, 2) as ajuste
      from _saldos s order by s.nombre
  loop
    if r.inicial <> 0 then
      v_orden := v_orden + 1;
      insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
      values (v_asiento, v_orden, r.plan_id, 'Saldo anterior del primer extracto cargado',
              greatest(-r.inicial, 0), greatest(r.inicial, 0));
      v_total := v_total + r.inicial;
    end if;
    if r.ajuste <> 0 then
      v_orden := v_orden + 1;
      insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
      values (v_asiento, v_orden, r.plan_id,
              'Ajuste a último extracto (' || to_char(r.fecha_final, 'DD/MM/YYYY') || ', '
                || to_char(r.final, 'FM999G999G990D00') || '): meses sin extracto y diferencias de lectura',
              greatest(-r.ajuste, 0), greatest(r.ajuste, 0));
      v_total := v_total + r.ajuste;
    end if;
  end loop;

  -- FAVORITO conserva su saldo inicial hasta que se revisen sus extractos.
  for r in
    select l.cuenta_id, l.detalle, l.debe, l.haber
      from public.asiento_lineas l
      join public.plan_cuentas p on p.id = l.cuenta_id
     where l.asiento_id = v_viejo and p.codigo = '2.1.03.02'
  loop
    v_orden := v_orden + 1;
    insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
    values (v_asiento, v_orden, r.cuenta_id, 'Saldo inicial anterior, pendiente de revisar sus extractos',
            r.debe, r.haber);
    v_total := v_total + r.haber - r.debe;
  end loop;

  -- El diferido de Diners al arranque: lo que quedaba después del último
  -- extracto (cuota 28 de 60, 15/09/2026: 32 cuotas de 216,20) más las
  -- cuotas que los extractos cargados le van restando.
  select coalesce(sum(monto), 0), max(monto) into v_d0, v_cuota
    from public.movimientos_extracto
   where cuenta_id = v_diners and categoria_id = v_cat_diners and naturaleza = 'DEBITO';
  if v_cuota is null or v_cuota <> 216.20 then
    raise exception 'La cuota de la reprogramación de Diners no es 216,20 (%)', v_cuota;
  end if;
  v_d0 := v_d0 + 32 * 216.20;

  v_orden := v_orden + 1;
  insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
  values (v_asiento, v_orden, v_dif_diners,
          'Reprogramación de Diners pendiente al primer extracto cargado', 0, v_d0);
  v_total := v_total + v_d0;

  v_orden := v_orden + 1;
  insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
  values (v_asiento, v_orden, v_patrimonio, 'Deuda de tarjetas anterior a los extractos cargados',
          greatest(v_total, 0), greatest(-v_total, 0));

  update public.asientos set estado = 'CONTABILIZADO' where id = v_asiento;

  if v_viejo is not null then
    update public.asientos
       set estado = 'ANULADO',
           glosa = glosa || ' · anulado: sustituido por los saldos cuadrados al último extracto (0029)'
     where id = v_viejo;
  end if;

  -- ------------------------------------------------------------------
  -- 6. El avance EfectivoÁgil del Austro, como diferido
  --
  -- Las cuotas de 255,21 y la precancelación de julio (6.477,34) bajan el
  -- diferido; sumadas dan lo que se debía al nacer, en marzo de 2026, con el
  -- primer cargo del avance. El dinero del avance no aparece en ningún
  -- extracto cargado —llegaría a la cuenta de ahorros del Austro, que no tiene
  -- extractos—, así que entra contra resultados acumulados hasta que se cargue.
  -- Las cuotas incluyen interés: hasta tener la tabla de amortización, todo
  -- se trata como capital.
  -- ------------------------------------------------------------------
  select coalesce(sum(monto), 0) into v_d0
    from public.movimientos_extracto
   where cuenta_id = v_austro and categoria_id = v_cat_austro and naturaleza = 'DEBITO';

  if v_d0 > 0 then
    insert into public.asientos (entidad_id, fecha, glosa, tipo, origen, estado)
    values (v_ent, '2026-03-19',
            'Avance EfectivoÁgil del Visa Austro: deuda diferida al nacer; el dinero recibido no está en los extractos cargados (0029)',
            'DIARIO', 'MANUAL', 'BORRADOR')
    returning id into v_asiento;

    insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
    values (v_asiento, 1, v_dif_austro, 'EfectivoÁgil: cuotas y precancelación posteriores', 0, v_d0),
           (v_asiento, 2, v_patrimonio, 'Destino del avance por identificar', v_d0, 0);

    update public.asientos set estado = 'CONTABILIZADO' where id = v_asiento;
  end if;
end $$;
