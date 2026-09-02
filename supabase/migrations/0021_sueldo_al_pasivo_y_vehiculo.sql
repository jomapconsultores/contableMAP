-- ---------------------------------------------------------------------
-- El sueldo pendiente es una deuda, y el vehículo es un bien
--
-- Dos cosas estaban en el lado equivocado del balance:
--
-- 1) «Sueldos acreditados pendientes de rol» vivía en el activo y por eso se
--    leía como un banco en números rojos: −2.089,25. No es dinero que falte,
--    es dinero que ya entró y cuyo ingreso todavía no se ha reconocido porque
--    el rol de agosto no está cargado. Eso es una obligación, no un activo, y
--    su sitio está en el pasivo corriente.
--
-- 2) Los 15.000 del vehículo estaban como cuenta por cobrar a Carlos Raúl
--    Posligua Montúfar. La declaración los recoge así por la forma del
--    formulario, pero el bien es del declarante: va a propiedad, planta y
--    equipo, junto al resto de activos fijos.
--
-- El balance no cambia de total: lo que se mueve, se mueve de sitio.
-- ---------------------------------------------------------------------

do $$
declare
  v_ent    uuid;
  v_origen uuid;
  v_dest   uuid;
  v_padre  record;
begin
  select id into v_ent from public.entidades order by created_at limit 1;
  if v_ent is null then
    return;
  end if;

  -- ------------------------------------------------------------------
  -- 1. La bolsa del sueldo pasa al pasivo
  -- ------------------------------------------------------------------
  select id into v_origen from public.plan_cuentas
   where entidad_id = v_ent and codigo = '1.1.01.98';

  if v_origen is not null then
    select * into v_padre from public.plan_cuentas
     where entidad_id = v_ent and codigo = '2.1';

    insert into public.plan_cuentas
      (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
    values (v_ent, '2.1.07', 'Sueldos acreditados pendientes de rol',
            'PASIVO', 'CORRIENTE', 'C', v_padre.id, v_padre.nivel + 1, true)
    on conflict (entidad_id, codigo) do nothing;

    select id into v_dest from public.plan_cuentas
     where entidad_id = v_ent and codigo = '2.1.07';

    update public.asiento_lineas set cuenta_id = v_dest where cuenta_id = v_origen;

    update public.categorias_gasto set cuenta_id = v_dest
     where entidad_id = v_ent and nombre = 'ACREDITACIÓN DE SUELDO';

    delete from public.plan_cuentas where id = v_origen;
  end if;

  -- ------------------------------------------------------------------
  -- 2. El vehículo deja de ser una cuenta por cobrar
  -- ------------------------------------------------------------------
  select p.id into v_origen
    from public.plan_cuentas p
    join public.terceros t on t.identificacion = '1702086305' and t.entidad_id = p.entidad_id
   where p.entidad_id = v_ent
     and p.codigo like '1.1.02.03.%'
     and p.nombre = left(t.razon_social, 60);

  if v_origen is not null then
    select * into v_padre from public.plan_cuentas
     where entidad_id = v_ent and codigo = '1.2.01';

    insert into public.plan_cuentas
      (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
    values (v_ent, '1.2.01.04', 'Vehículo', v_padre.tipo, v_padre.subtipo,
            v_padre.naturaleza, v_padre.id, v_padre.nivel + 1, true)
    on conflict (entidad_id, codigo) do nothing;

    select id into v_dest from public.plan_cuentas
     where entidad_id = v_ent and codigo = '1.2.01.04';

    update public.asiento_lineas
       set cuenta_id = v_dest,
           tercero_id = null,
           detalle = 'Vehículo'
     where cuenta_id = v_origen;

    delete from public.plan_cuentas where id = v_origen;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- La vista de control y la siembra miran ahora al pasivo.
-- El saldo pendiente es acreedor: haber menos debe.
-- ---------------------------------------------------------------------
create or replace view public.v_sueldos_sin_acreditar
with (security_invoker = true) as
select
  a.entidad_id,
  round(sum(l.haber) - sum(l.debe), 2) as pendiente_de_acreditar
from public.asiento_lineas l
join public.asientos a on a.id = l.asiento_id
join public.plan_cuentas p on p.id = l.cuenta_id
where p.codigo = '2.1.07'
group by a.entidad_id
having round(sum(l.haber) - sum(l.debe), 2) <> 0;

comment on view public.v_sueldos_sin_acreditar is
  'Sueldos ya depositados cuyo rol falta por cargar: el ingreso aún no se reconoce.';

create or replace function public.fn_sembrar_acreditacion_sueldo(p_entidad uuid)
returns void language plpgsql as $$
begin
  insert into public.plan_cuentas
    (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
  select p_entidad, '2.1.07', 'Sueldos acreditados pendientes de rol',
         'PASIVO', 'CORRIENTE', 'C', p.id, p.nivel + 1, true
    from public.plan_cuentas p
   where p.entidad_id = p_entidad and p.codigo = '2.1'
  on conflict (entidad_id, codigo) do nothing;

  insert into public.categorias_gasto
    (entidad_id, nombre, cuenta_id, rubro_personal, deducible_negocio, credito_iva)
  values (
    p_entidad, 'ACREDITACIÓN DE SUELDO',
    (select id from public.plan_cuentas
      where entidad_id = p_entidad and codigo = '2.1.07'),
    null, false, false)
  on conflict (entidad_id, nombre) do update set cuenta_id = excluded.cuenta_id;
end $$;

comment on function public.fn_sembrar_acreditacion_sueldo(uuid) is
  'Cuenta puente del sueldo, en el pasivo, y su categoría. Se llama al crear una entidad.';
