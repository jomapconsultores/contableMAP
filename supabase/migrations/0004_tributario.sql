-- =====================================================================
-- ContableMAP · 0004 · Documentos tributarios
-- Compras, ventas, retenciones y roles de pago. Las bases replican la
-- estructura de tributos-web: 0 %, 5 %, 8 %, 15 %, no objeto y exento.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Compras (comprobantes recibidos) → libro de compras y crédito de IVA
-- ---------------------------------------------------------------------
create table if not exists public.compras (
  id                   uuid primary key default gen_random_uuid(),
  entidad_id           uuid not null references public.entidades(id) on delete cascade,
  documento_id         uuid references public.documentos(id) on delete set null,
  fecha                date not null,
  tipo_comprobante     text not null default 'FACTURA'
                         check (tipo_comprobante in ('FACTURA','NOTA_VENTA','LIQUIDACION_COMPRA',
                                                     'NOTA_CREDITO','NOTA_DEBITO','TIQUETE',
                                                     'REEMBOLSO','IMPORTACION','OTRO')),
  establecimiento      text,
  punto_emision        text,
  secuencial           text,
  numero               text generated always as (
                         coalesce(establecimiento,'') || '-' ||
                         coalesce(punto_emision,'')   || '-' ||
                         coalesce(secuencial,'')
                       ) stored,
  autorizacion         text,
  clave_acceso         text,
  tercero_id           uuid references public.terceros(id) on delete set null,
  ruc_proveedor        text not null,
  nombre_proveedor     text not null,

  -- Desglose de bases imponibles
  base_0               numeric(16,2) not null default 0,
  base_5               numeric(16,2) not null default 0,
  base_8               numeric(16,2) not null default 0,
  base_15              numeric(16,2) not null default 0,
  no_objeto_iva        numeric(16,2) not null default 0,
  exento_iva           numeric(16,2) not null default 0,
  iva_5                numeric(16,2) not null default 0,
  iva_8                numeric(16,2) not null default 0,
  iva_15               numeric(16,2) not null default 0,
  ice                  numeric(16,2) not null default 0,
  descuento            numeric(16,2) not null default 0,
  propina              numeric(16,2) not null default 0,
  total                numeric(16,2) not null default 0,

  -- Clasificación (igual criterio que tributos-web)
  categoria_id         uuid references public.categorias_gasto(id) on delete set null,
  clasificado_por      text check (clasificado_por in ('MAPA','IA','MANUAL')),
  confianza_ia         numeric(4,3),
  concepto             text,

  -- Tratamiento tributario
  sustento_tributario  text,   -- código de sustento del anexo (01, 02, 03, ...)
  da_credito_iva       boolean not null default true,
  deducible_ir         boolean not null default true,
  -- Rubro de gasto personal (se hereda de la categoría, editable por caso)
  rubro_personal       text check (rubro_personal in
                         ('VIVIENDA','EDUCACION','SALUD','ALIMENTACION','VESTIMENTA','TURISMO')),

  forma_pago           text,
  cuenta_financiera_id uuid references public.cuentas_financieras(id) on delete set null,
  a_credito            boolean not null default false,
  fecha_vencimiento    date,

  asiento_id           uuid references public.asientos(id) on delete set null,
  estado               text not null default 'REGISTRADA'
                         check (estado in ('REGISTRADA','CONTABILIZADA','ANULADA')),
  xml_origen           text,
  notas                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (entidad_id, ruc_proveedor, numero, tipo_comprobante)
);

create index if not exists idx_compras_entidad on public.compras(entidad_id, fecha desc);
create index if not exists idx_compras_periodo on public.compras(entidad_id, (extract(year from fecha)), (extract(month from fecha)));
create index if not exists idx_compras_cat     on public.compras(categoria_id);

-- ---------------------------------------------------------------------
-- Ventas (comprobantes emitidos) → libro de ventas e IVA en ventas
-- ---------------------------------------------------------------------
create table if not exists public.ventas (
  id                   uuid primary key default gen_random_uuid(),
  entidad_id           uuid not null references public.entidades(id) on delete cascade,
  documento_id         uuid references public.documentos(id) on delete set null,
  fecha                date not null,
  tipo_comprobante     text not null default 'FACTURA'
                         check (tipo_comprobante in ('FACTURA','NOTA_VENTA','NOTA_CREDITO',
                                                     'NOTA_DEBITO','LIQUIDACION','EXPORTACION','OTRO')),
  establecimiento      text,
  punto_emision        text,
  secuencial           text,
  numero               text generated always as (
                         coalesce(establecimiento,'') || '-' ||
                         coalesce(punto_emision,'')   || '-' ||
                         coalesce(secuencial,'')
                       ) stored,
  autorizacion         text,
  clave_acceso         text,
  tercero_id           uuid references public.terceros(id) on delete set null,
  tipo_id_cliente      text not null default 'RUC'
                         check (tipo_id_cliente in ('RUC','CEDULA','PASAPORTE','CONSUMIDOR_FINAL','IDENT_EXTERIOR')),
  id_cliente           text,
  razon_social_cliente text not null,

  base_0               numeric(16,2) not null default 0,
  base_5               numeric(16,2) not null default 0,
  base_8               numeric(16,2) not null default 0,
  base_15              numeric(16,2) not null default 0,
  no_objeto_iva        numeric(16,2) not null default 0,
  exento_iva           numeric(16,2) not null default 0,
  iva_5                numeric(16,2) not null default 0,
  iva_8                numeric(16,2) not null default 0,
  iva_15               numeric(16,2) not null default 0,
  ice                  numeric(16,2) not null default 0,
  descuento            numeric(16,2) not null default 0,
  total                numeric(16,2) not null default 0,

  -- Cuenta de ingreso a la que se imputa
  cuenta_ingreso_id    uuid references public.plan_cuentas(id) on delete set null,
  concepto             text,
  forma_pago           text,
  cuenta_financiera_id uuid references public.cuentas_financieras(id) on delete set null,
  a_credito            boolean not null default false,
  fecha_vencimiento    date,

  asiento_id           uuid references public.asientos(id) on delete set null,
  estado               text not null default 'REGISTRADA'
                         check (estado in ('REGISTRADA','CONTABILIZADA','ANULADA')),
  xml_origen           text,
  notas                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (entidad_id, numero, tipo_comprobante)
);

create index if not exists idx_ventas_entidad on public.ventas(entidad_id, fecha desc);
create index if not exists idx_ventas_periodo on public.ventas(entidad_id, (extract(year from fecha)), (extract(month from fecha)));

-- ---------------------------------------------------------------------
-- Retenciones: las que nos efectúan (RECIBIDA) y las que efectuamos (EFECTUADA)
-- ---------------------------------------------------------------------
create table if not exists public.retenciones (
  id                uuid primary key default gen_random_uuid(),
  entidad_id        uuid not null references public.entidades(id) on delete cascade,
  clase             text not null check (clase in ('RECIBIDA','EFECTUADA')),
  fecha             date not null,
  numero            text,
  autorizacion      text,
  periodo_fiscal    text,
  tercero_id        uuid references public.terceros(id) on delete set null,
  ruc_contraparte   text not null,
  nombre_contraparte text not null,
  -- Documento sobre el que se practicó la retención
  venta_id          uuid references public.ventas(id) on delete set null,
  compra_id         uuid references public.compras(id) on delete set null,

  base_renta        numeric(16,2) not null default 0,
  porc_renta        numeric(8,4)  not null default 0,
  ret_renta         numeric(16,2) not null default 0,
  codigo_renta      text,
  base_iva          numeric(16,2) not null default 0,
  porc_iva          numeric(8,4)  not null default 0,
  ret_iva           numeric(16,2) not null default 0,
  codigo_iva        text,
  ret_isd           numeric(16,2) not null default 0,
  total_retenido    numeric(16,2) generated always as (ret_renta + ret_iva + ret_isd) stored,

  asiento_id        uuid references public.asientos(id) on delete set null,
  estado            text not null default 'REGISTRADA'
                      check (estado in ('REGISTRADA','CONTABILIZADA','ANULADA')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_retenciones_entidad on public.retenciones(entidad_id, fecha desc);
create index if not exists idx_retenciones_clase   on public.retenciones(entidad_id, clase);

-- ---------------------------------------------------------------------
-- Roles de pago: ingreso en relación de dependencia
-- ---------------------------------------------------------------------
create table if not exists public.roles_pago (
  id                  uuid primary key default gen_random_uuid(),
  entidad_id          uuid not null references public.entidades(id) on delete cascade,
  documento_id        uuid references public.documentos(id) on delete set null,
  anio                int not null,
  mes                 int not null check (mes between 1 and 12),
  tercero_id          uuid references public.terceros(id) on delete set null,
  ruc_empleador       text,
  nombre_empleador    text not null,

  -- Ingresos
  sueldo              numeric(16,2) not null default 0,
  horas_extra         numeric(16,2) not null default 0,
  comisiones          numeric(16,2) not null default 0,
  bonos               numeric(16,2) not null default 0,
  fondos_reserva      numeric(16,2) not null default 0,
  decimo_tercero      numeric(16,2) not null default 0,
  decimo_cuarto       numeric(16,2) not null default 0,
  otros_ingresos      numeric(16,2) not null default 0,
  total_ingresos      numeric(16,2) not null default 0,

  -- Descuentos
  aporte_iess         numeric(16,2) not null default 0,
  impuesto_renta      numeric(16,2) not null default 0,
  prestamos_iess      numeric(16,2) not null default 0,
  anticipos           numeric(16,2) not null default 0,
  otros_descuentos    numeric(16,2) not null default 0,
  total_descuentos    numeric(16,2) not null default 0,

  liquido_recibir     numeric(16,2) not null default 0,
  cuenta_financiera_id uuid references public.cuentas_financieras(id) on delete set null,

  asiento_id          uuid references public.asientos(id) on delete set null,
  estado              text not null default 'REGISTRADO'
                        check (estado in ('REGISTRADO','CONTABILIZADO','ANULADO')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (entidad_id, ruc_empleador, anio, mes)
);

create index if not exists idx_roles_entidad on public.roles_pago(entidad_id, anio desc, mes desc);

-- updated_at
do $$
declare t text;
begin
  foreach t in array array['compras','ventas','retenciones','roles_pago']
  loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end $$;

-- Vincular el movimiento del extracto con su factura formal
alter table public.movimientos_extracto
  drop constraint if exists movimientos_extracto_compra_id_fkey;
alter table public.movimientos_extracto
  add constraint movimientos_extracto_compra_id_fkey
  foreign key (compra_id) references public.compras(id) on delete set null;
