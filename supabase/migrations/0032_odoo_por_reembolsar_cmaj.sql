-- ---------------------------------------------------------------------
-- Odoo también es de CMAJ
--
-- El Odoo donde se lleva la contabilidad de CMAJ se paga con las tarjetas del
-- titular: Amex de octubre de 2025 a julio de 2026, PacifiCard en agosto y
-- Mastercard Produbanco desde septiembre (38,80 el 30/09/2026, aún sin
-- extracto). Como Claude y Hetzner en la 0031, es un gasto por reembolsar.
-- ---------------------------------------------------------------------

do $$
declare
  v_ent uuid;
  v_cat uuid;
begin
  select id into v_ent from public.entidades order by created_at limit 1;
  if v_ent is null then
    return;
  end if;
  select id into v_cat from public.categorias_gasto where entidad_id = v_ent and nombre = 'REEMBOLSO CMAJ';
  if v_cat is null then
    raise exception 'Falta la categoría REEMBOLSO CMAJ (0031)';
  end if;

  update public.movimientos_extracto m
     set categoria_id = v_cat, clasificado_por = 'MANUAL', confianza_ia = null
   where m.entidad_id = v_ent and m.asiento_id is null and m.descripcion ~* 'odoo';

  update public.mapa_clasificacion
     set categoria_id = v_cat, origen = 'MANUAL', confirmado = true
   where entidad_id = v_ent and tipo_clave = 'COMERCIO' and clave ~* 'odoo';
  insert into public.mapa_clasificacion (entidad_id, tipo_clave, clave, categoria_id, origen, confirmado)
  values (v_ent, 'COMERCIO', 'ODOO INC. BRISBANE', v_cat, 'MANUAL', true),
         (v_ent, 'COMERCIO', 'ODOO TECHNOLOGIES', v_cat, 'MANUAL', true)
  on conflict (entidad_id, tipo_clave, clave)
    do update set categoria_id = excluded.categoria_id, origen = 'MANUAL', confirmado = true;
end $$;
