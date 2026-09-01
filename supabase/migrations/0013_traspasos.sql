-- ---------------------------------------------------------------------
-- Traspasos entre cuentas propias
--
-- Pagar la tarjeta con el dinero del banco no es un gasto: es el mismo
-- patrimonio cambiando de sitio. Hasta ahora no había forma de decirlo, y esos
-- movimientos quedaban en «SIN CLASIFICAR» —21 movimientos y 3.804,89 solo en
-- los extractos cargados—, camino de contabilizarse como gasto y de inflar el
-- resultado del ejercicio por partida doble: una vez en la tarjeta y otra en el
-- banco.
--
-- La solución es una cuenta puente. El pago visto desde la tarjeta deja el
-- puente al haber; el mismo pago visto desde el extracto del banco lo deja al
-- debe. Cuando los dos extractos están cargados, el puente vale cero, y
-- mientras no valga cero está diciendo que falta cargar el otro lado.
-- ---------------------------------------------------------------------

-- Cuenta puente bajo «Efectivo y equivalentes», para cada entidad que ya exista.
insert into public.plan_cuentas
  (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
select
  e.id, '1.1.01.99', 'Traspasos entre cuentas', 'ACTIVO', 'CORRIENTE', 'D',
  (select id from public.plan_cuentas p where p.entidad_id = e.id and p.codigo = '1.1.01'),
  3, true
from public.entidades e
on conflict (entidad_id, codigo) do nothing;

-- Categoría que apunta a esa cuenta. No es gasto: ni deducible ni con IVA.
insert into public.categorias_gasto
  (entidad_id, nombre, cuenta_id, rubro_personal, deducible_negocio, credito_iva)
select
  e.id, 'TRASPASO ENTRE CUENTAS',
  (select id from public.plan_cuentas p where p.entidad_id = e.id and p.codigo = '1.1.01.99'),
  null, false, false
from public.entidades e
on conflict (entidad_id, nombre) do nothing;

-- ---------------------------------------------------------------------
-- Que las entidades nuevas nazcan con ambas cosas.
-- ---------------------------------------------------------------------
create or replace function public.fn_sembrar_traspasos(p_entidad uuid)
returns void language plpgsql as $$
declare v_cuenta uuid;
begin
  insert into public.plan_cuentas
    (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
  values
    (p_entidad, '1.1.01.99', 'Traspasos entre cuentas', 'ACTIVO', 'CORRIENTE', 'D',
     (select id from public.plan_cuentas where entidad_id = p_entidad and codigo = '1.1.01'),
     3, true)
  on conflict (entidad_id, codigo) do nothing;

  select id into v_cuenta
    from public.plan_cuentas
   where entidad_id = p_entidad and codigo = '1.1.01.99';

  insert into public.categorias_gasto
    (entidad_id, nombre, cuenta_id, rubro_personal, deducible_negocio, credito_iva)
  values (p_entidad, 'TRASPASO ENTRE CUENTAS', v_cuenta, null, false, false)
  on conflict (entidad_id, nombre) do nothing;
end $$;

comment on function public.fn_sembrar_traspasos(uuid) is
  'Cuenta puente y categoría de traspaso. Se llama al crear una entidad.';

-- ---------------------------------------------------------------------
-- Saldo del puente: lo que está a medio cargar.
-- ---------------------------------------------------------------------
create or replace view public.v_traspasos_sin_cuadrar
with (security_invoker = true) as
select
  a.entidad_id,
  sum(l.debe)  as debe,
  sum(l.haber) as haber,
  round(sum(l.debe) - sum(l.haber), 2) as descuadre
from public.asiento_lineas l
join public.asientos a on a.id = l.asiento_id
join public.plan_cuentas p on p.id = l.cuenta_id
where p.codigo = '1.1.01.99'
group by a.entidad_id
having round(sum(l.debe) - sum(l.haber), 2) <> 0;

comment on view public.v_traspasos_sin_cuadrar is
  'Traspasos con un solo lado contabilizado: falta cargar el extracto de la otra cuenta.';
