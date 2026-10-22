-- ---------------------------------------------------------------------
-- Los reembolsos de CMAJ empiezan en mayo de 2026
--
-- Lo que el titular pagó por CMAJ hasta abril de 2026 ya está cobrado en las
-- facturas 001-001-000000008 a 010 (1.214,60). Por eso solo es gasto por
-- reembolsar lo pagado desde el 01/05/2026:
--   · Odoo de octubre de 2025 a marzo de 2026 vuelve a software (la 0032 lo
--     había movido entero).
--   · HeyGen, Metricool y Cloudflare, que también son de CMAJ, pasan a la
--     cuenta por cobrar desde mayo. IONOS no tiene cargos desde mayo.
-- Las reglas del mapa dejan los próximos cargos de los cuatro servicios en
-- REEMBOLSO CMAJ.
-- ---------------------------------------------------------------------

do $$
declare
  v_ent      uuid;
  v_cat      uuid;
  v_software uuid;
begin
  select id into v_ent from public.entidades order by created_at limit 1;
  if v_ent is null then
    return;
  end if;
  select id into v_cat from public.categorias_gasto where entidad_id = v_ent and nombre = 'REEMBOLSO CMAJ';
  select id into v_software from public.categorias_gasto where entidad_id = v_ent and nombre = 'SOFTWARE';
  if v_cat is null or v_software is null then
    raise exception 'Faltan las categorías REEMBOLSO CMAJ o SOFTWARE';
  end if;

  update public.movimientos_extracto m
     set categoria_id = v_software, clasificado_por = 'MANUAL', confianza_ia = null
   where m.entidad_id = v_ent and m.asiento_id is null
     and m.categoria_id = v_cat and m.fecha < date '2026-05-01';

  update public.movimientos_extracto m
     set categoria_id = v_cat, clasificado_por = 'MANUAL', confianza_ia = null
   where m.entidad_id = v_ent and m.asiento_id is null and m.naturaleza = 'DEBITO'
     and m.fecha >= date '2026-05-01'
     and m.descripcion ~* '(heygen|ionos|metricool|cloudflare)';

  update public.mapa_clasificacion
     set categoria_id = v_cat, origen = 'MANUAL', confirmado = true
   where entidad_id = v_ent and tipo_clave = 'COMERCIO'
     and clave ~* '(heygen|ionos|metricool|cloudflare)';
  insert into public.mapa_clasificacion (entidad_id, tipo_clave, clave, categoria_id, origen, confirmado)
  values (v_ent, 'COMERCIO', 'HEYGEN TECHNOLOGY INC.', v_cat, 'MANUAL', true),
         (v_ent, 'COMERCIO', 'PAYPAL *METRICOOL', v_cat, 'MANUAL', true),
         (v_ent, 'COMERCIO', 'CLOUDFLARE', v_cat, 'MANUAL', true),
         (v_ent, 'COMERCIO', 'IONOS INC.', v_cat, 'MANUAL', true)
  on conflict (entidad_id, tipo_clave, clave)
    do update set categoria_id = excluded.categoria_id, origen = 'MANUAL', confirmado = true;
end $$;
