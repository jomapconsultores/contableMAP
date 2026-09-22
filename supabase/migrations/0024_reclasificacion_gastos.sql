-- ---------------------------------------------------------------------
-- Cada gasto en su sitio
--
-- Revisión de las categorías que la IA y el mapa pusieron a los movimientos de
-- tarjeta. Los errores no eran inocuos: la contribución a SOLCA contaba como
-- gasto de salud —deducible en la renta— y las cuotas de la deuda reprogramada
-- de Diners, 216,20 cada una, entraban como intereses del año.
--
-- Criterios que no salen de la descripción, confirmados por el titular:
--   · ETAPA le cobra agua y teléfono de casa: es vivienda, como la luz.
--   · El vehículo se usa para trabajar: matrícula y EMOV son gasto del negocio.
--   · Megamaxi a 30 cuotas fue tecnología; a 15, electrodoméstico.
--   · La reprogramación de Diners es capital de una deuda vieja. Su saldo
--     pendiente ya entró contra resultados acumulados (0019), y sus cuotas
--     van al mismo sitio: no son gasto del ejercicio.
--
-- «Cargos capital anterior» de PacifiCard se queda en intereses. Pese al
-- nombre, el banco lo suma al saldo como cargo nuevo: es el interés sobre el
-- capital anterior, no el capital.
--
-- Un movimiento contabilizado lleva su categoría también en el asiento. Cambiar
-- solo la categoría dejaría los estados financieros con la cuenta vieja, así
-- que cada cambio corrige además la línea de gasto de su asiento.
-- ---------------------------------------------------------------------

do $$
declare
  v_ent uuid;
begin
  select id into v_ent from public.entidades order by created_at limit 1;
  if v_ent is null then
    return;
  end if;

  -- 1. Categorías que faltaban
  insert into public.categorias_gasto
    (entidad_id, nombre, cuenta_id, deducible_negocio, credito_iva)
  select v_ent, 'CUOTA DE DEUDA ANTERIOR', id, false, false
    from public.plan_cuentas where entidad_id = v_ent and codigo = '3.2'
  on conflict (entidad_id, nombre) do nothing;

  insert into public.categorias_gasto
    (entidad_id, nombre, cuenta_id, deducible_negocio, credito_iva)
  select v_ent, 'MATRÍCULA VEHICULAR', id, true, false
    from public.plan_cuentas where entidad_id = v_ent and codigo = '6.1.13'
  on conflict (entidad_id, nombre) do nothing;

  -- 2. Qué movimiento va a qué categoría
  create temp table _reclas on commit drop as
  select m.id, m.asiento_id, m.comercio,
         c.cuenta_id as cuenta_vieja,
         n.id as cat_nueva, n.cuenta_id as cuenta_nueva
    from public.movimientos_extracto m
    join public.categorias_gasto c on c.id = m.categoria_id
    cross join lateral (
      select case
        when m.descripcion ~* '^PAYPAL' and c.nombre = 'VARIOS'              then 'DONACIONES'
        when m.descripcion ~* 'SOLCA' and c.nombre = 'SALUD'                 then 'INTERESES'
        when m.descripcion ~* 'IVA.*SERVICIO DIGITAL'
             and c.nombre in ('SOFTWARE', 'INTERNET', 'SERVICIOS BANCARIOS') then 'IVA SERVICIOS DIGITALES'
        when m.descripcion ~* 'FYBECA' and c.nombre = 'SERVICIOS BANCARIOS'  then 'SALUD'
        when m.descripcion ~* 'SINDICATO DE CHOFERES' and c.nombre = 'GAS'   then 'GASOLINA'
        when m.descripcion ~* 'KUSHKI|KUSMKI|NUVEI|RICAUD'                   then 'COMISIÓN RECAUDACIÓN'
        when m.descripcion ~* 'COMPNWEB'                                     then 'COMISIÓN BANCARIA'
        when m.descripcion ~* '^PAGO TARDIO'                                 then 'SERVICIOS BANCARIOS'
        when m.descripcion ~* '^ASIS' and c.nombre = 'SEGUROS'               then 'SALUD'
        when m.descripcion ~* '^REPROGRAMACI'                                then 'CUOTA DE DEUDA ANTERIOR'
        when m.descripcion ~* 'ETAPA' and c.nombre = 'INTERNET'              then 'VIVIENDA'
        when m.descripcion ~* 'SRI INTERNET MAT'                             then 'MATRÍCULA VEHICULAR'
        when m.descripcion ~* 'EMOV'                                         then 'MOVILIDAD'
        when m.descripcion ~* 'MEGAMAXI.*CUOTA [0-9]+/30'                    then 'EQUIPOS DE COMPUTACIÓN'
        when m.descripcion ~* 'MEGAMAXI.*CUOTA [0-9]+/15'                    then 'ELECTRODOMÉSTICOS'
      end as nombre
    ) r
    join public.categorias_gasto n
      on n.entidad_id = v_ent and n.nombre = r.nombre
   where m.entidad_id = v_ent
     and n.id <> m.categoria_id;

  -- 3. El asiento primero, mientras aún se sabe cuál era la cuenta vieja
  update public.asiento_lineas l
     set cuenta_id = r.cuenta_nueva
    from _reclas r
   where l.asiento_id = r.asiento_id
     and l.cuenta_id = r.cuenta_vieja
     and r.cuenta_nueva is distinct from r.cuenta_vieja;

  update public.movimientos_extracto m
     set categoria_id = r.cat_nueva, clasificado_por = 'MANUAL', confianza_ia = null
    from _reclas r
   where m.id = r.id;

  -- 4. Las dos cuotas de ETAPA que el mapa guardaba bajo «PTP» —el prefijo de
  --    la pasarela, no el comercio— pasan a llamarse por quien cobra.
  update public.movimientos_extracto
     set comercio = 'ETAPA EP'
   where entidad_id = v_ent and comercio = 'PTP' and descripcion ~* 'ETAPA';

  -- 5. Lo aprendido, para los extractos que vengan
  insert into public.mapa_clasificacion
    (entidad_id, tipo_clave, clave, nombre_origen, categoria_id, origen, confirmado)
  select distinct on (m.comercio)
         v_ent, 'COMERCIO', m.comercio, m.descripcion, m.categoria_id, 'MANUAL', true
    from public.movimientos_extracto m
    join _reclas r on r.id = m.id
   where m.comercio is not null
     and m.comercio not in ('SRI', 'MEGAMAXI CUENCA MERCANCIAS')
  on conflict (entidad_id, tipo_clave, clave) do update
     set categoria_id = excluded.categoria_id, origen = 'MANUAL', confirmado = true;

  -- La confianza de las cuotas de asistencia, que ya estaban en salud
  update public.mapa_clasificacion
     set origen = 'MANUAL', confirmado = true
   where entidad_id = v_ent and clave ~ '^ASIS';

  -- Claves que no dicen qué se compra: «PTP» es cualquier pago por la
  -- pasarela, al SRI se le paga más que la matrícula y en Megamaxi se compra
  -- comida. Mejor que las juzgue cada vez el modelo que acertar por costumbre.
  delete from public.mapa_clasificacion
   where entidad_id = v_ent
     and tipo_clave = 'COMERCIO'
     and clave in ('PTP', 'SRI', 'MEGAMAXI CUENCA MERCANCIAS');
end $$;
