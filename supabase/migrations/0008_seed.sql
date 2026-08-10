-- =====================================================================
-- ContableMAP · 0008 · Semillas
-- Parámetros fiscales y provisión automática de plan de cuentas +
-- taxonomía de gastos para cada entidad nueva.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Parámetros fiscales.
-- Los valores son los de referencia al crear el sistema: se editan desde
-- la aplicación cada vez que el SRI publica la tabla del ejercicio.
-- ---------------------------------------------------------------------
insert into public.parametros_fiscales
  (anio, fraccion_basica_desgravada, canasta_basica, topes_gastos_personales,
   porcentaje_rebaja_gp, tabla_ir, tarifas_iva, notas)
values
  (2025, 11902.00, 806.00,
   '{"GLOBAL":7,"VIVIENDA":3.25,"EDUCACION":3.25,"SALUD":7,"ALIMENTACION":3.25,"VESTIMENTA":3.25,"TURISMO":3.25}'::jsonb,
   0.18,
   '[
     {"desde":0,        "hasta":11902,  "impuesto_fraccion_basica":0,       "porcentaje_excedente":0.00},
     {"desde":11902,    "hasta":15159,  "impuesto_fraccion_basica":0,       "porcentaje_excedente":0.05},
     {"desde":15159,    "hasta":19682,  "impuesto_fraccion_basica":163,     "porcentaje_excedente":0.10},
     {"desde":19682,    "hasta":26031,  "impuesto_fraccion_basica":615,     "porcentaje_excedente":0.12},
     {"desde":26031,    "hasta":34255,  "impuesto_fraccion_basica":1377,    "porcentaje_excedente":0.15},
     {"desde":34255,    "hasta":45407,  "impuesto_fraccion_basica":2611,    "porcentaje_excedente":0.20},
     {"desde":45407,    "hasta":60450,  "impuesto_fraccion_basica":4841,    "porcentaje_excedente":0.25},
     {"desde":60450,    "hasta":80605,  "impuesto_fraccion_basica":8602,    "porcentaje_excedente":0.30},
     {"desde":80605,    "hasta":107199, "impuesto_fraccion_basica":14648,   "porcentaje_excedente":0.35},
     {"desde":107199,   "hasta":null,   "impuesto_fraccion_basica":23956,   "porcentaje_excedente":0.37}
   ]'::jsonb,
   '{0,5,8,15}',
   'Valores de referencia. Verificar y actualizar con la resolución del SRI del ejercicio.')
on conflict (anio) do nothing;

insert into public.parametros_fiscales
  (anio, fraccion_basica_desgravada, canasta_basica, topes_gastos_personales,
   porcentaje_rebaja_gp, tabla_ir, tarifas_iva, notas)
select 2026, fraccion_basica_desgravada, canasta_basica, topes_gastos_personales,
       porcentaje_rebaja_gp, tabla_ir, tarifas_iva,
       'Copiado de 2025. Actualizar con la resolución del SRI para 2026.'
  from public.parametros_fiscales where anio = 2025
on conflict (anio) do nothing;

-- ---------------------------------------------------------------------
-- Plan de cuentas base
-- ---------------------------------------------------------------------
create or replace function public.fn_seed_plan_cuentas(p_entidad uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
  v_padre uuid;
begin
  for r in
    select * from (values
      -- codigo,      nombre,                                   tipo,        subtipo,               nat, movimiento
      ('1',           'ACTIVO',                                 'ACTIVO',    null,                  'D', false),
      ('1.1',         'ACTIVO CORRIENTE',                       'ACTIVO',    'CORRIENTE',           'D', false),
      ('1.1.01',      'Efectivo y equivalentes',                'ACTIVO',    'CORRIENTE',           'D', false),
      ('1.1.01.01',   'Caja',                                   'ACTIVO',    'CORRIENTE',           'D', true),
      ('1.1.01.02',   'Bancos',                                 'ACTIVO',    'CORRIENTE',           'D', true),
      ('1.1.01.03',   'Cooperativas',                           'ACTIVO',    'CORRIENTE',           'D', true),
      ('1.1.02',      'Cuentas y documentos por cobrar',        'ACTIVO',    'CORRIENTE',           'D', false),
      ('1.1.02.01',   'Clientes',                               'ACTIVO',    'CORRIENTE',           'D', true),
      ('1.1.02.02',   'Documentos por cobrar',                  'ACTIVO',    'CORRIENTE',           'D', true),
      ('1.1.02.03',   'Otras cuentas por cobrar',               'ACTIVO',    'CORRIENTE',           'D', true),
      ('1.1.03',      'Crédito tributario',                     'ACTIVO',    'CORRIENTE',           'D', false),
      ('1.1.03.01',   'IVA en compras',                         'ACTIVO',    'CORRIENTE',           'D', true),
      ('1.1.03.02',   'Crédito tributario IVA',                 'ACTIVO',    'CORRIENTE',           'D', true),
      ('1.1.03.03',   'Retenciones de renta recibidas',         'ACTIVO',    'CORRIENTE',           'D', true),
      ('1.1.03.04',   'Retenciones de IVA recibidas',           'ACTIVO',    'CORRIENTE',           'D', true),
      ('1.1.04',      'Inventarios',                            'ACTIVO',    'CORRIENTE',           'D', true),
      ('1.1.05',      'Gastos anticipados',                     'ACTIVO',    'CORRIENTE',           'D', true),
      ('1.2',         'ACTIVO NO CORRIENTE',                    'ACTIVO',    'NO_CORRIENTE',        'D', false),
      ('1.2.01',      'Propiedad, planta y equipo',             'ACTIVO',    'NO_CORRIENTE',        'D', true),
      ('1.2.02',      'Depreciación acumulada',                 'ACTIVO',    'NO_CORRIENTE',        'C', true),
      ('1.2.03',      'Inversiones',                            'ACTIVO',    'NO_CORRIENTE',        'D', true),

      ('2',           'PASIVO',                                 'PASIVO',    null,                  'C', false),
      ('2.1',         'PASIVO CORRIENTE',                       'PASIVO',    'CORRIENTE',           'C', false),
      ('2.1.01',      'Proveedores',                            'PASIVO',    'CORRIENTE',           'C', true),
      ('2.1.02',      'Documentos por pagar',                   'PASIVO',    'CORRIENTE',           'C', true),
      ('2.1.03',      'Tarjetas de crédito por pagar',          'PASIVO',    'CORRIENTE',           'C', true),
      ('2.1.04',      'Obligaciones tributarias',               'PASIVO',    'CORRIENTE',           'C', false),
      ('2.1.04.01',   'IVA en ventas',                          'PASIVO',    'CORRIENTE',           'C', true),
      ('2.1.04.02',   'IVA por pagar',                          'PASIVO',    'CORRIENTE',           'C', true),
      ('2.1.04.03',   'Retenciones de IVA por pagar',           'PASIVO',    'CORRIENTE',           'C', true),
      ('2.1.04.04',   'Retenciones de renta por pagar',         'PASIVO',    'CORRIENTE',           'C', true),
      ('2.1.04.05',   'Impuesto a la renta por pagar',          'PASIVO',    'CORRIENTE',           'C', true),
      ('2.1.05',      'Obligaciones con el IESS',               'PASIVO',    'CORRIENTE',           'C', true),
      ('2.1.06',      'Beneficios sociales por pagar',          'PASIVO',    'CORRIENTE',           'C', true),
      ('2.2',         'PASIVO NO CORRIENTE',                    'PASIVO',    'NO_CORRIENTE',        'C', false),
      ('2.2.01',      'Préstamos a largo plazo',                'PASIVO',    'NO_CORRIENTE',        'C', true),

      ('3',           'PATRIMONIO',                             'PATRIMONIO', null,                 'C', false),
      ('3.1',         'Capital',                                'PATRIMONIO', 'CAPITAL',            'C', true),
      ('3.2',         'Resultados acumulados',                  'PATRIMONIO', 'RESULTADOS',         'C', true),
      ('3.3',         'Resultado del ejercicio',                'PATRIMONIO', 'RESULTADOS',         'C', true),
      ('3.4',         'Aportes y retiros del propietario',      'PATRIMONIO', 'CAPITAL',            'C', true),

      ('4',           'INGRESOS',                               'INGRESO',   null,                  'C', false),
      ('4.1',         'Ingresos operacionales',                 'INGRESO',   'OPERACIONAL',         'C', false),
      ('4.1.01',      'Venta de bienes',                        'INGRESO',   'OPERACIONAL',         'C', true),
      ('4.1.02',      'Prestación de servicios',                'INGRESO',   'OPERACIONAL',         'C', true),
      ('4.1.03',      'Honorarios profesionales',               'INGRESO',   'OPERACIONAL',         'C', true),
      ('4.1.04',      'Arriendos',                              'INGRESO',   'OPERACIONAL',         'C', true),
      ('4.2',         'Ingresos en relación de dependencia',    'INGRESO',   'NO_OPERACIONAL',      'C', true),
      ('4.3',         'Otros ingresos',                         'INGRESO',   'NO_OPERACIONAL',      'C', true),
      ('4.4',         'Rendimientos financieros',               'INGRESO',   'NO_OPERACIONAL',      'C', true),

      ('5',           'COSTOS',                                 'COSTO',     null,                  'D', false),
      ('5.1',         'Costo de ventas',                        'COSTO',     'COSTO_VENTAS',        'D', true),
      ('5.2',         'Mano de obra directa',                   'COSTO',     'COSTO_VENTAS',        'D', true),

      ('6',           'GASTOS',                                 'GASTO',     null,                  'D', false),
      ('6.1',         'Gastos operativos',                      'GASTO',     'OPERATIVO',           'D', false),
      ('6.1.01',      'Sueldos y salarios',                     'GASTO',     'OPERATIVO',           'D', true),
      ('6.1.02',      'Beneficios sociales y aportes',          'GASTO',     'OPERATIVO',           'D', true),
      ('6.1.03',      'Servicios básicos',                      'GASTO',     'OPERATIVO',           'D', true),
      ('6.1.04',      'Arriendos',                              'GASTO',     'OPERATIVO',           'D', true),
      ('6.1.05',      'Combustible y lubricantes',              'GASTO',     'OPERATIVO',           'D', true),
      ('6.1.06',      'Mantenimiento y reparaciones',           'GASTO',     'OPERATIVO',           'D', true),
      ('6.1.07',      'Suministros y materiales',               'GASTO',     'OPERATIVO',           'D', true),
      ('6.1.08',      'Servicios profesionales',                'GASTO',     'OPERATIVO',           'D', true),
      ('6.1.09',      'Transporte y movilización',              'GASTO',     'OPERATIVO',           'D', true),
      ('6.1.10',      'Seguros',                                'GASTO',     'OPERATIVO',           'D', true),
      ('6.1.11',      'Publicidad y promoción',                 'GASTO',     'OPERATIVO',           'D', true),
      ('6.1.12',      'Depreciaciones',                         'GASTO',     'OPERATIVO',           'D', true),
      ('6.1.13',      'Impuestos, tasas y contribuciones',      'GASTO',     'OPERATIVO',           'D', true),
      ('6.1.14',      'Tecnología y comunicaciones',            'GASTO',     'OPERATIVO',           'D', true),
      ('6.1.99',      'Otros gastos operativos',                'GASTO',     'OPERATIVO',           'D', true),
      ('6.2',         'Gastos financieros',                     'GASTO',     'FINANCIERO',          'D', false),
      ('6.2.01',      'Intereses',                              'GASTO',     'FINANCIERO',          'D', true),
      ('6.2.02',      'Comisiones y servicios bancarios',       'GASTO',     'FINANCIERO',          'D', true),
      ('6.3',         'Gastos personales deducibles',           'GASTO',     'PERSONAL',            'D', false),
      ('6.3.01',      'Vivienda',                               'GASTO',     'PERSONAL',            'D', true),
      ('6.3.02',      'Educación, arte y cultura',              'GASTO',     'PERSONAL',            'D', true),
      ('6.3.03',      'Salud',                                  'GASTO',     'PERSONAL',            'D', true),
      ('6.3.04',      'Alimentación',                           'GASTO',     'PERSONAL',            'D', true),
      ('6.3.05',      'Vestimenta',                             'GASTO',     'PERSONAL',            'D', true),
      ('6.3.06',      'Turismo',                                'GASTO',     'PERSONAL',            'D', true),
      ('6.9',         'Gastos no deducibles',                   'GASTO',     'NO_DEDUCIBLE',        'D', true)
    ) as t(codigo, nombre, tipo, subtipo, naturaleza, es_movimiento)
    order by t.codigo
  loop
    -- El padre es el prefijo del código hasta el último punto
    v_padre := null;
    if position('.' in r.codigo) > 0 then
      select id into v_padre
        from public.plan_cuentas
       where entidad_id = p_entidad
         and codigo = left(r.codigo, length(r.codigo) - position('.' in reverse(r.codigo)));
    end if;

    insert into public.plan_cuentas
      (entidad_id, codigo, nombre, tipo, subtipo, naturaleza, padre_id, nivel, es_movimiento)
    values
      (p_entidad, r.codigo, r.nombre, r.tipo, r.subtipo, r.naturaleza::char(1),
       v_padre,
       length(r.codigo) - length(replace(r.codigo, '.', '')) + 1,
       r.es_movimiento)
    on conflict (entidad_id, codigo) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Taxonomía de gastos (misma nomenclatura que tributos-web)
-- ---------------------------------------------------------------------
create or replace function public.fn_seed_categorias(p_entidad uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
  v_cuenta uuid;
begin
  for r in
    select * from (values
      -- nombre,                        cuenta,      rubro personal,  deducible negocio, crédito IVA
      ('ALIMENTACIÓN',                  '6.3.04',    'ALIMENTACION',  false, false),
      ('VIVIENDA',                      '6.3.01',    'VIVIENDA',      false, false),
      ('SALUD',                         '6.3.03',    'SALUD',         false, false),
      ('EDUCACIÓN',                     '6.3.02',    'EDUCACION',     false, false),
      ('VESTIMENTA',                    '6.3.05',    'VESTIMENTA',    false, false),
      ('TURISMO',                       '6.3.06',    'TURISMO',       false, false),
      ('HOSPEDAJE',                     '6.3.06',    'TURISMO',       false, false),
      ('GASOLINA',                      '6.1.05',    null,            true,  true),
      ('DIESEL',                        '6.1.05',    null,            true,  true),
      ('MANTENIMIENTO VEHÍCULO',        '6.1.06',    null,            true,  true),
      ('REPUESTOS',                     '6.1.06',    null,            true,  true),
      ('MANTENIMIENTO MAQUINARIA',      '6.1.06',    null,            true,  true),
      ('MATERIALES DE CONSTRUCCIÓN',    '6.1.07',    null,            true,  true),
      ('FERRETERIA',                    '6.1.07',    null,            true,  true),
      ('MATERIALES DE LIMPIEZA',        '6.1.07',    null,            true,  true),
      ('SUMINISTROS',                   '6.1.07',    null,            true,  true),
      ('OFICINA',                       '6.1.07',    null,            true,  true),
      ('BAZAR',                         '6.1.07',    null,            true,  true),
      ('SERVICIOS PROFESIONALES',       '6.1.08',    null,            true,  true),
      ('HONORARIOS PROFESIONALES',      '6.1.08',    null,            true,  true),
      ('CONTABILIDAD',                  '6.1.08',    null,            true,  true),
      ('SERVICIOS TRIBUTARIOS',         '6.1.08',    null,            true,  true),
      ('NOTARIA',                       '6.1.08',    null,            true,  true),
      ('SERVICIOS ADMINISTRATIVOS',     '6.1.08',    null,            true,  true),
      ('TRANSPORTE',                    '6.1.09',    null,            true,  true),
      ('PARQUEADERO',                   '6.1.09',    null,            true,  true),
      ('PEAJE',                         '6.1.09',    null,            true,  true),
      ('MOVILIDAD',                     '6.1.09',    null,            true,  true),
      ('ENVÍO DE DOCUMENTOS',           '6.1.09',    null,            true,  true),
      ('SEGUROS',                       '6.1.10',    null,            true,  true),
      ('PUBLICIDAD',                    '6.1.11',    null,            true,  true),
      ('SERVICIOS BÁSICOS',             '6.1.03',    null,            true,  true),
      ('SERVICIO ALUMBRADO ELÉCTRICO',  '6.1.03',    null,            true,  true),
      ('GAS',                           '6.1.03',    null,            true,  true),
      ('INTERNET',                      '6.1.14',    null,            true,  true),
      ('TELEFONÍA CELULAR',             '6.1.14',    null,            true,  true),
      ('CELULAR',                       '6.1.14',    null,            true,  true),
      ('RECARGA CELULAR',               '6.1.14',    null,            true,  true),
      ('TELEVISIÓN CABLE',              '6.1.14',    null,            true,  true),
      ('STREAMING',                     '6.1.14',    null,            true,  true),
      ('SOFTWARE',                      '6.1.14',    null,            true,  true),
      ('EQUIPOS DE COMPUTACIÓN',        '1.2.01',    null,            true,  true),
      ('FIRMAS ELECTRÓNICAS',           '6.1.14',    null,            true,  true),
      ('ARRIENDO LOCAL',                '6.1.04',    null,            true,  true),
      ('COMISIÓN BANCARIA',             '6.2.02',    null,            true,  false),
      ('SERVICIOS BANCARIOS',           '6.2.02',    null,            true,  false),
      ('COMISIÓN RECAUDACIÓN',          '6.2.02',    null,            true,  false),
      ('INTERESES',                     '6.2.01',    null,            true,  false),
      ('MUNICIPIO',                     '6.1.13',    null,            true,  false),
      ('BOMBEROS',                      '6.1.13',    null,            true,  false),
      ('REGISTRO DE LA PROPIEDAD',      '6.1.13',    null,            true,  false),
      ('ELECTRODOMÉSTICOS',             '6.1.99',    null,            true,  true),
      ('MUEBLES',                       '1.2.01',    null,            true,  true),
      ('COSMÉTICOS',                    '6.9',       null,            false, false),
      ('LICORES',                       '6.9',       null,            false, false),
      ('VARIOS',                        '6.1.99',    null,            true,  true),
      ('OTROS',                         '6.1.99',    null,            true,  true),
      ('SIN CLASIFICAR',                '6.1.99',    null,            false, false)
    ) as t(nombre, codigo_cuenta, rubro_personal, deducible_negocio, credito_iva)
  loop
    select id into v_cuenta
      from public.plan_cuentas
     where entidad_id = p_entidad and codigo = r.codigo_cuenta;

    insert into public.categorias_gasto
      (entidad_id, nombre, cuenta_id, rubro_personal, deducible_negocio, credito_iva)
    values
      (p_entidad, r.nombre, v_cuenta, r.rubro_personal, r.deducible_negocio, r.credito_iva)
    on conflict (entidad_id, nombre) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Provisión automática al crear una entidad
-- ---------------------------------------------------------------------
create or replace function public.tg_provisiona_entidad()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  perform public.fn_seed_plan_cuentas(new.id);
  perform public.fn_seed_categorias(new.id);
  return new;
end $$;

drop trigger if exists provisiona_entidad on public.entidades;
create trigger provisiona_entidad after insert on public.entidades
for each row execute function public.tg_provisiona_entidad();
