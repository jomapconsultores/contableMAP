-- =====================================================================
-- ContableMAP · 0003 · Ingesta: cuentas financieras, documentos cargados
-- y líneas de estados de cuenta (bancos, tarjetas, cooperativas).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Cuentas financieras: bancos, tarjetas de crédito, cooperativas, caja
-- ---------------------------------------------------------------------
create table if not exists public.cuentas_financieras (
  id             uuid primary key default gen_random_uuid(),
  entidad_id     uuid not null references public.entidades(id) on delete cascade,
  nombre         text not null,
  tipo           text not null
                   check (tipo in ('BANCO','TARJETA_CREDITO','COOPERATIVA','CAJA','INVERSION')),
  institucion    text,
  numero         text,               -- últimos dígitos / número enmascarado
  moneda         char(3) not null default 'USD',
  -- Cuenta contable asociada (Bancos, Tarjeta por pagar, etc.)
  cuenta_id      uuid references public.plan_cuentas(id) on delete set null,
  -- Datos propios de tarjeta de crédito
  dia_corte      int check (dia_corte between 1 and 31),
  dia_pago       int check (dia_pago between 1 and 31),
  cupo           numeric(16,2),
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (entidad_id, nombre)
);

create index if not exists idx_cuentas_fin_entidad on public.cuentas_financieras(entidad_id);

-- ---------------------------------------------------------------------
-- Documentos cargados (PDF, imagen, XML, CSV) y su estado de proceso
-- ---------------------------------------------------------------------
create table if not exists public.documentos (
  id                uuid primary key default gen_random_uuid(),
  entidad_id        uuid not null references public.entidades(id) on delete cascade,
  tipo              text not null
                      check (tipo in ('ESTADO_TARJETA','ESTADO_BANCO','ESTADO_COOPERATIVA',
                                      'FACTURA_COMPRA','FACTURA_VENTA','ROL_PAGO',
                                      'RETENCION','NOTA_CREDITO','OTRO')),
  nombre_archivo    text not null,
  storage_path      text not null,
  mime_type         text,
  tamano_bytes      bigint,
  -- Cuenta financiera a la que corresponde el extracto (si aplica)
  cuenta_id         uuid references public.cuentas_financieras(id) on delete set null,
  periodo_desde     date,
  periodo_hasta     date,
  estado            text not null default 'PENDIENTE'
                      check (estado in ('PENDIENTE','PROCESANDO','EXTRAIDO','CONTABILIZADO','ERROR')),
  -- Resultado crudo de la extracción con IA
  extraccion        jsonb,
  resumen           text,
  error_mensaje     text,
  modelo_ia         text,
  tokens_entrada    int,
  tokens_salida     int,
  procesado_at      timestamptz,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_documentos_entidad on public.documentos(entidad_id, created_at desc);
create index if not exists idx_documentos_estado  on public.documentos(entidad_id, estado);

drop trigger if exists set_updated_at on public.documentos;
create trigger set_updated_at before update on public.documentos
for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Movimientos de extracto: cada línea de un estado de cuenta.
-- Es la materia prima que la IA clasifica y luego se contabiliza.
-- ---------------------------------------------------------------------
create table if not exists public.movimientos_extracto (
  id                uuid primary key default gen_random_uuid(),
  entidad_id        uuid not null references public.entidades(id) on delete cascade,
  documento_id      uuid references public.documentos(id) on delete cascade,
  cuenta_id         uuid not null references public.cuentas_financieras(id) on delete cascade,
  fecha             date not null,
  fecha_valor       date,
  descripcion       text not null,
  -- Comercio normalizado a partir de la descripción (clave de aprendizaje)
  comercio          text,
  referencia        text,
  -- Signo contable del movimiento respecto de la cuenta financiera
  naturaleza        text not null check (naturaleza in ('DEBITO','CREDITO')),
  monto             numeric(16,2) not null check (monto > 0),
  moneda            char(3) not null default 'USD',
  -- Clasificación
  categoria_id      uuid references public.categorias_gasto(id) on delete set null,
  tercero_id        uuid references public.terceros(id) on delete set null,
  clasificado_por   text check (clasificado_por in ('MAPA','IA','MANUAL')),
  confianza_ia      numeric(4,3),
  -- Conciliación y contabilización
  asiento_id        uuid references public.asientos(id) on delete set null,
  conciliado        boolean not null default false,
  -- Vínculo con la factura formal cuando existe
  compra_id         uuid,
  -- Huella para evitar duplicados al recargar el mismo extracto
  hash_linea        text not null,
  notas             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (entidad_id, cuenta_id, hash_linea)
);

create index if not exists idx_mov_extracto_entidad on public.movimientos_extracto(entidad_id, fecha desc);
create index if not exists idx_mov_extracto_cuenta  on public.movimientos_extracto(cuenta_id, fecha desc);
create index if not exists idx_mov_extracto_pend    on public.movimientos_extracto(entidad_id)
  where asiento_id is null;

drop trigger if exists set_updated_at on public.movimientos_extracto;
create trigger set_updated_at before update on public.movimientos_extracto
for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Bitácora de llamadas a la IA (auditoría y control de costo)
-- ---------------------------------------------------------------------
create table if not exists public.ia_ejecuciones (
  id             uuid primary key default gen_random_uuid(),
  entidad_id     uuid references public.entidades(id) on delete cascade,
  tipo           text not null
                   check (tipo in ('EXTRACCION_DOC','CLASIFICACION','VOZ','ASIENTO','CONSULTA')),
  modelo         text not null,
  referencia_id  uuid,
  tokens_entrada int,
  tokens_salida  int,
  duracion_ms    int,
  exito          boolean not null default true,
  error_mensaje  text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_ia_entidad on public.ia_ejecuciones(entidad_id, created_at desc);
