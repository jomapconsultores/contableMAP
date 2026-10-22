-- ---------------------------------------------------------------------
-- Lo que el titular paga por CMAJ es una cuenta por cobrar, no un gasto
--
-- CMAJ Asociados S.A.S. usa servicios que el titular paga con sus tarjetas:
--   · Claude (Anthropic): plan Pro y luego Max, de mayo a octubre de 2026.
--   · Hetzner: el servidor donde corren los sistemas, desde julio de 2026.
-- Y en Sukasa compró para CMAJ, a crédito directo, el 12/09/2026:
--   · factura 044-013-000049433, proyector Epson PowerLite E20 (780,29);
--   · factura 044-013-000049431, audífonos JBL, almohadas, cojín y garantía
--     extendida (253,84).
-- La batería externa de la factura 040-103-000023235 es del titular y no
-- entra. Los intereses de la 018-103-000173645 tampoco, mientras no se
-- decida otra cosa.
--
-- Todo eso le corresponde a CMAJ: va a «CMAJ · gastos por reembolsar», una
-- cuenta por cobrar, en vez de a gasto de software o de bazar.
--
-- Los cargos ya cargados (Amex mayo-julio, PacifiCard julio-agosto) se
-- recategorizan; todavía no tienen asiento, así que basta con la categoría.
-- Las reglas del mapa se apuntan a la nueva categoría para que los extractos
-- que faltan (Claude y Hetzner de agosto a octubre) entren solos donde deben.
-- Sukasa no se mapea: no todo lo que se compra allí es de CMAJ; las dos
-- compras de septiembre se recategorizan cuando llegue su extracto.
-- ---------------------------------------------------------------------

do $$
declare
  v_ent     uuid;
  v_padre   uuid;
  v_cuenta  uuid;
  v_cat     uuid;
begin
  select id into v_ent from public.entidades order by created_at limit 1;
  if v_ent is null then
    return;
  end if;

  select id into v_padre from public.plan_cuentas where entidad_id = v_ent and codigo = '1.1.02.03';

  insert into public.plan_cuentas
    (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
  select v_ent, '1.1.02.03.04', 'CMAJ ASOCIADOS S.A.S. · gastos por reembolsar',
         p.tipo, p.subtipo, p.naturaleza, p.id, p.nivel + 1, true
    from public.plan_cuentas p where p.id = v_padre
  on conflict (entidad_id, codigo) do nothing;
  select id into v_cuenta from public.plan_cuentas where entidad_id = v_ent and codigo = '1.1.02.03.04';

  insert into public.categorias_gasto (entidad_id, nombre, cuenta_id, deducible_negocio, credito_iva)
  values (v_ent, 'REEMBOLSO CMAJ', v_cuenta, false, false)
  on conflict (entidad_id, nombre) do update set cuenta_id = excluded.cuenta_id;
  select id into v_cat from public.categorias_gasto where entidad_id = v_ent and nombre = 'REEMBOLSO CMAJ';

  -- Lo ya cargado y sin asiento.
  update public.movimientos_extracto m
     set categoria_id = v_cat, clasificado_por = 'MANUAL', confianza_ia = null
   where m.entidad_id = v_ent and m.asiento_id is null
     and m.descripcion ~* '(claude|anthropic|hetzner)';

  -- Lo que llegue en los próximos extractos.
  update public.mapa_clasificacion
     set categoria_id = v_cat, origen = 'MANUAL', confirmado = true
   where entidad_id = v_ent and tipo_clave = 'COMERCIO'
     and clave in ('ANTHROPIC', 'CLAUDE AI', 'HETZNER', 'HETZNER ONLINE');
  insert into public.mapa_clasificacion (entidad_id, tipo_clave, clave, categoria_id, origen, confirmado)
  values (v_ent, 'COMERCIO', 'CLAUDE.AI SUBSCRIPTION', v_cat, 'MANUAL', true),
         (v_ent, 'COMERCIO', 'ANTHROPIC* CLAUDE SUB', v_cat, 'MANUAL', true),
         (v_ent, 'COMERCIO', 'PAYPAL *HETZNER', v_cat, 'MANUAL', true)
  on conflict (entidad_id, tipo_clave, clave)
    do update set categoria_id = excluded.categoria_id, origen = 'MANUAL', confirmado = true;
end $$;
