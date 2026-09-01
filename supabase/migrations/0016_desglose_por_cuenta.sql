-- ---------------------------------------------------------------------
-- Una cuenta contable por cada cuenta financiera
--
-- Las siete tarjetas ya tienen la suya —2.1.03.01 a 2.1.03.07— y por eso el
-- balance puede decir cuánto se debe en cada una. Los bancos y las libretas de
-- la cooperativa seguían compartiendo «1.1.01.02 Bancos» y «1.1.01.03
-- Cooperativas»: once cuentas de ahorro sumadas en un único renglón, sin forma
-- de saber cuánto hay en cada una ni de cuadrar ninguna contra su extracto.
--
-- Esta migración le da subcuenta propia a cada cuenta financiera, reapunta lo
-- ya registrado y deja las dos cuentas de siempre como agrupación. Desde aquí
-- cualquier cuenta financiera nueva nace con la suya: lo hace un trigger, no la
-- aplicación, para que dé igual si la crea el formulario, la carga de un
-- extracto o un script.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. La bolsa provisional del sueldo deja de ser «Bancos»
--
-- La migración 0014 hizo que el rol dejara el líquido en «Bancos» y que la
-- acreditación vista desde el extracto lo sacara de ahí, para no contar dos
-- veces la misma remuneración. Al dividir «Bancos» por cuenta, esa bolsa no
-- puede seguir en una cuenta de agrupación —ni asomar en el balance como un
-- banco con saldo negativo, que es lo que se veía—. Pasa a tener la suya, al
-- lado de la de traspasos, con el mismo espíritu: si le queda saldo, está
-- diciendo que falta cargar el extracto donde cayó el depósito.
-- ---------------------------------------------------------------------
insert into public.plan_cuentas
  (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
select e.id, '1.1.01.98', 'Sueldos acreditados pendientes de rol',
       'ACTIVO', 'CORRIENTE', 'D', p.id, p.nivel + 1, true
from public.entidades e
join public.plan_cuentas p on p.entidad_id = e.id and p.codigo = '1.1.01'
on conflict (entidad_id, codigo) do nothing;

-- ---------------------------------------------------------------------
-- 2. La subcuenta de una cuenta financiera, creándola si aún no existe
--
-- Devuelve la cuenta contable propia de esa cuenta financiera. Si ya tiene una
-- que no es la agrupadora de su tipo, se respeta —así las tarjetas conservan la
-- que 2.1.03.0x les dio—. Si no, se crea con el primer código libre bajo la
-- agrupadora.
-- ---------------------------------------------------------------------
create or replace function public.fn_cuenta_de_financiera(p_cuenta_financiera uuid)
returns uuid language plpgsql as $$
declare
  v_fin    record;
  v_actual record;
  v_padre  record;
  v_raiz   text;
  v_codigo text;
  v_id     uuid;
begin
  select * into v_fin from public.cuentas_financieras where id = p_cuenta_financiera;
  if not found then
    return null;
  end if;

  v_raiz := case v_fin.tipo
              when 'TARJETA_CREDITO' then '2.1.03'
              when 'COOPERATIVA'     then '1.1.01.03'
              when 'CAJA'            then '1.1.01.01'
              else                        '1.1.01.02'
            end;

  select * into v_actual from public.plan_cuentas where id = v_fin.cuenta_id;
  if found and v_actual.codigo <> v_raiz then
    return v_actual.id;
  end if;

  select * into v_padre
    from public.plan_cuentas
   where entidad_id = v_fin.entidad_id and codigo = v_raiz;
  if not found then
    return v_fin.cuenta_id;
  end if;

  -- Primer código libre: dos dígitos, como el de las tarjetas.
  select v_raiz || '.' || lpad(
           (coalesce(max(substring(codigo from '[0-9]+$')::int), 0) + 1)::text, 2, '0')
    into v_codigo
    from public.plan_cuentas
   where entidad_id = v_fin.entidad_id
     and padre_id = v_padre.id
     and codigo ~ ('^' || replace(v_raiz, '.', '\.') || '\.[0-9]{2}$');

  insert into public.plan_cuentas
    (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
  values
    (v_fin.entidad_id, v_codigo, left(v_fin.nombre, 60), v_padre.tipo, v_padre.subtipo,
     v_padre.naturaleza, v_padre.id, v_padre.nivel + 1, true)
  returning id into v_id;

  -- En cuanto una familia tiene subcuentas, la de arriba solo agrupa.
  update public.plan_cuentas set es_movimiento = false where id = v_padre.id;

  return v_id;
end $$;

comment on function public.fn_cuenta_de_financiera(uuid) is
  'Cuenta contable propia de una cuenta financiera; la crea bajo su agrupadora si falta.';

-- Las que ya existen reciben la suya, en un orden estable.
do $$
declare r record;
begin
  for r in
    select id from public.cuentas_financieras order by entidad_id, tipo, nombre, id
  loop
    update public.cuentas_financieras
       set cuenta_id = public.fn_cuenta_de_financiera(r.id)
     where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Lo ya registrado se muda a la subcuenta que le toca
--
-- El orden importa: primero lo que sale de la bolsa del sueldo, que también
-- vivía en «Bancos» y no es el saldo de ningún banco; después el resto.
-- ---------------------------------------------------------------------

-- El líquido que dejó cada rol de pago.
update public.asiento_lineas l
   set cuenta_id = destino.id
  from public.asientos a
  join public.plan_cuentas origen
    on origen.entidad_id = a.entidad_id and origen.codigo = '1.1.01.02'
  join public.plan_cuentas destino
    on destino.entidad_id = a.entidad_id and destino.codigo = '1.1.01.98'
 where a.id = l.asiento_id
   and a.origen = 'ROL_PAGO'
   and l.cuenta_id = origen.id;

-- La contrapartida de la acreditación vista desde el extracto.
update public.asiento_lineas l
   set cuenta_id = destino.id
  from public.asientos a
  join public.movimientos_extracto m on m.id = a.origen_id
  join public.categorias_gasto cat on cat.id = m.categoria_id
  join public.plan_cuentas origen
    on origen.entidad_id = a.entidad_id and origen.codigo = '1.1.01.02'
  join public.plan_cuentas destino
    on destino.entidad_id = a.entidad_id and destino.codigo = '1.1.01.98'
 where a.id = l.asiento_id
   and a.origen = 'EXTRACTO'
   and cat.nombre = 'ACREDITACIÓN DE SUELDO'
   and l.cuenta_id = origen.id;

-- El movimiento de cada extracto, a la cuenta de la que salió o entró.
update public.asiento_lineas l
   set cuenta_id = cf.cuenta_id
  from public.asientos a
  join public.movimientos_extracto m on m.id = a.origen_id
  join public.cuentas_financieras cf on cf.id = m.cuenta_id
  join public.plan_cuentas origen on origen.id = l.cuenta_id
 where a.id = l.asiento_id
   and a.origen = 'EXTRACTO'
   and origen.codigo in ('1.1.01.02', '1.1.01.03')
   and cf.cuenta_id is not null
   and cf.cuenta_id <> l.cuenta_id;

-- ---------------------------------------------------------------------
-- 4. El asiento de apertura de la cooperativa, repartido
--
-- Entró como una sola línea de 5.246,89 para las diez libretas. Los importes
-- son los que se dedujeron de cada extracto en su día: saldo tras el primer
-- movimiento menos ese movimiento.
-- ---------------------------------------------------------------------
do $$
declare
  v_linea record;
  v_orden int;
  r       record;
begin
  for v_linea in
    select l.*, a.entidad_id
      from public.asiento_lineas l
      join public.asientos a on a.id = l.asiento_id
      join public.plan_cuentas p on p.id = l.cuenta_id
     where p.codigo = '1.1.01.03'
       and a.origen = 'MANUAL'
       and a.glosa like 'Saldos iniciales de las cuentas de Jard%'
  loop
    select coalesce(max(orden), 0) into v_orden
      from public.asiento_lineas where asiento_id = v_linea.asiento_id;

    for r in
      select * from (values
        ('1939365', 3668.65), ('2255157', 1264.23), ('2774216',  87.74),
        ('2807514',  118.34), ('2830867',   10.79), ('2830868',  10.79),
        ('2830869',   10.79), ('2830870',   53.98), ('2830871',  10.79),
        ('2830872',   10.79)
      ) as t(numero, importe)
    loop
      v_orden := v_orden + 1;
      insert into public.asiento_lineas (asiento_id, orden, cuenta_id, detalle, debe, haber)
      select v_linea.asiento_id, v_orden, cf.cuenta_id,
             'Saldo al 01/01/2026 · ' || cf.nombre, r.importe, 0
        from public.cuentas_financieras cf
       where cf.entidad_id = v_linea.entidad_id
         and cf.tipo = 'COOPERATIVA'
         and cf.numero = r.numero;
    end loop;

    delete from public.asiento_lineas where id = v_linea.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Las dos cuentas de siempre pasan a ser agrupación
--
-- A partir de aquí la base rechaza cualquier asiento que intente usarlas: un
-- error futuro falla en voz alta en lugar de volver a esconder once saldos
-- dentro de uno.
-- ---------------------------------------------------------------------
-- Si algo quedó apuntando a ellas, la migración para aquí: una línea olvidada
-- en una cuenta de agrupación desaparece de los informes sin avisar, porque el
-- balance solo mira las cuentas de movimiento.
do $$
declare v_sueltas int;
begin
  select count(*) into v_sueltas
    from public.asiento_lineas l
    join public.plan_cuentas p on p.id = l.cuenta_id
   where p.codigo in ('1.1.01.02', '1.1.01.03');

  if v_sueltas > 0 then
    raise exception 'Quedan % líneas en «Bancos» o «Cooperativas» sin subcuenta', v_sueltas;
  end if;
end $$;

update public.plan_cuentas
   set es_movimiento = false
 where codigo in ('1.1.01.02', '1.1.01.03')
   and exists (select 1 from public.plan_cuentas h where h.padre_id = plan_cuentas.id);

-- ---------------------------------------------------------------------
-- 6. La categoría de la acreditación apunta a la bolsa nueva
-- ---------------------------------------------------------------------
update public.categorias_gasto c
   set cuenta_id = p.id
  from public.plan_cuentas p
 where p.entidad_id = c.entidad_id
   and p.codigo = '1.1.01.98'
   and c.nombre = 'ACREDITACIÓN DE SUELDO';

create or replace function public.fn_sembrar_acreditacion_sueldo(p_entidad uuid)
returns void language plpgsql as $$
begin
  insert into public.plan_cuentas
    (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
  select p_entidad, '1.1.01.98', 'Sueldos acreditados pendientes de rol',
         'ACTIVO', 'CORRIENTE', 'D', p.id, p.nivel + 1, true
    from public.plan_cuentas p
   where p.entidad_id = p_entidad and p.codigo = '1.1.01'
  on conflict (entidad_id, codigo) do nothing;

  insert into public.categorias_gasto
    (entidad_id, nombre, cuenta_id, rubro_personal, deducible_negocio, credito_iva)
  values (
    p_entidad, 'ACREDITACIÓN DE SUELDO',
    (select id from public.plan_cuentas
      where entidad_id = p_entidad and codigo = '1.1.01.98'),
    null, false, false)
  on conflict (entidad_id, nombre) do update set cuenta_id = excluded.cuenta_id;
end $$;

comment on function public.fn_sembrar_acreditacion_sueldo(uuid) is
  'Bolsa del sueldo y su categoría: evitan contar dos veces el rol y el extracto.';

-- La vista de control mira ahora la bolsa, no «Bancos».
create or replace view public.v_sueldos_sin_acreditar
with (security_invoker = true) as
select
  a.entidad_id,
  round(sum(l.debe) - sum(l.haber), 2) as pendiente_de_acreditar
from public.asiento_lineas l
join public.asientos a on a.id = l.asiento_id
join public.plan_cuentas p on p.id = l.cuenta_id
where p.codigo = '1.1.01.98'
group by a.entidad_id
having round(sum(l.debe) - sum(l.haber), 2) <> 0;

comment on view public.v_sueldos_sin_acreditar is
  'Saldo de la bolsa del sueldo: faltan por cargar los extractos donde cayó el depósito.';

-- ---------------------------------------------------------------------
-- 7. Toda cuenta financiera nueva nace con su cuenta contable
--
-- La aplicación sigue enviando la agrupadora al crearla; el trigger la cambia
-- por una subcuenta propia. Solo en el alta: al modificar una cuenta se respeta
-- lo que tenga, incluso si alguien la reapunta a mano.
-- ---------------------------------------------------------------------
create or replace function public.tg_cuenta_financiera_subcuenta()
returns trigger language plpgsql as $$
declare
  v_raiz   text;
  v_actual record;
  v_padre  record;
  v_codigo text;
begin
  v_raiz := case new.tipo
              when 'TARJETA_CREDITO' then '2.1.03'
              when 'COOPERATIVA'     then '1.1.01.03'
              when 'CAJA'            then '1.1.01.01'
              else                        '1.1.01.02'
            end;

  select * into v_actual from public.plan_cuentas where id = new.cuenta_id;
  if found and v_actual.codigo <> v_raiz then
    return new;
  end if;

  select * into v_padre
    from public.plan_cuentas
   where entidad_id = new.entidad_id and codigo = v_raiz;
  if not found then
    return new;
  end if;

  select v_raiz || '.' || lpad(
           (coalesce(max(substring(codigo from '[0-9]+$')::int), 0) + 1)::text, 2, '0')
    into v_codigo
    from public.plan_cuentas
   where entidad_id = new.entidad_id
     and padre_id = v_padre.id
     and codigo ~ ('^' || replace(v_raiz, '.', '\.') || '\.[0-9]{2}$');

  insert into public.plan_cuentas
    (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
  values
    (new.entidad_id, v_codigo, left(new.nombre, 60), v_padre.tipo, v_padre.subtipo,
     v_padre.naturaleza, v_padre.id, v_padre.nivel + 1, true)
  returning id into new.cuenta_id;

  update public.plan_cuentas set es_movimiento = false where id = v_padre.id;

  return new;
end $$;

drop trigger if exists cuenta_financiera_subcuenta on public.cuentas_financieras;
create trigger cuenta_financiera_subcuenta before insert on public.cuentas_financieras
for each row execute function public.tg_cuenta_financiera_subcuenta();
