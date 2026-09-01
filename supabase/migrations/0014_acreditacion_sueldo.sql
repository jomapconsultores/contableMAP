-- ---------------------------------------------------------------------
-- Acreditación del sueldo en la cuenta de ahorros
--
-- El rol de pago ya registra el ingreso del mes: debe el banco por el líquido,
-- debe el aporte personal, haber «Ingresos en relación de dependencia». Cuando
-- después se carga el extracto de la cuenta donde cayó ese depósito, el
-- movimiento vuelve a aparecer —esta vez como un crédito de 2.089,25— y si se
-- clasifica como cualquier ingreso, la misma remuneración entra dos veces al
-- estado de resultados.
--
-- La salida es la misma idea de la cuenta puente de los traspasos. Mientras no
-- se sepa a qué cuenta llegó el sueldo, el rol lo deja en «Bancos», que hace de
-- bolsa provisional. El depósito visto desde el extracto se clasifica como
-- ACREDITACIÓN DE SUELDO, que apunta a esa misma cuenta: el asiento debita la
-- cuenta real y acredita la bolsa. El ingreso no se duplica y «Bancos» se
-- vacía sola conforme llegan los extractos. Si le queda saldo, está diciendo
-- que faltan por cargar los extractos de las cuentas donde entró el sueldo.
-- ---------------------------------------------------------------------

insert into public.categorias_gasto
  (entidad_id, nombre, cuenta_id, rubro_personal, deducible_negocio, credito_iva)
select
  e.id, 'ACREDITACIÓN DE SUELDO',
  (select id from public.plan_cuentas p where p.entidad_id = e.id and p.codigo = '1.1.01.02'),
  null, false, false
from public.entidades e
on conflict (entidad_id, nombre) do nothing;

-- Que las entidades nuevas nazcan con ella.
create or replace function public.fn_sembrar_acreditacion_sueldo(p_entidad uuid)
returns void language plpgsql as $$
begin
  insert into public.categorias_gasto
    (entidad_id, nombre, cuenta_id, rubro_personal, deducible_negocio, credito_iva)
  values (
    p_entidad, 'ACREDITACIÓN DE SUELDO',
    (select id from public.plan_cuentas
      where entidad_id = p_entidad and codigo = '1.1.01.02'),
    null, false, false)
  on conflict (entidad_id, nombre) do nothing;
end $$;

comment on function public.fn_sembrar_acreditacion_sueldo(uuid) is
  'Categoría que evita contar dos veces el sueldo: rol y extracto. Se llama al crear una entidad.';

-- ---------------------------------------------------------------------
-- Sueldos registrados por rol cuyo depósito todavía no se ha cargado.
-- ---------------------------------------------------------------------
create or replace view public.v_sueldos_sin_acreditar
with (security_invoker = true) as
select
  a.entidad_id,
  round(sum(l.debe) - sum(l.haber), 2) as pendiente_de_acreditar
from public.asiento_lineas l
join public.asientos a on a.id = l.asiento_id
join public.plan_cuentas p on p.id = l.cuenta_id
where p.codigo = '1.1.01.02'
group by a.entidad_id
having round(sum(l.debe) - sum(l.haber), 2) <> 0;

comment on view public.v_sueldos_sin_acreditar is
  'Saldo de la bolsa provisional «Bancos»: faltan por cargar los extractos donde cayó el sueldo.';
