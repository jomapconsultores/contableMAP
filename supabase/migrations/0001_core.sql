-- =====================================================================
-- ContableMAP · 0001 · Núcleo: entidades, plan de cuentas, terceros,
-- taxonomía de gastos (compatible con tributos-web) y parámetros fiscales.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";

-- ---------------------------------------------------------------------
-- Entidad contable (persona natural o sociedad)
-- ---------------------------------------------------------------------
create table if not exists public.entidades (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  ruc                   text not null,
  razon_social          text not null,
  nombre_comercial      text,
  tipo_identificacion   text not null default 'RUC'
                          check (tipo_identificacion in ('RUC','CEDULA','PASAPORTE')),
  -- Régimen tributario ecuatoriano
  regimen               text not null default 'GENERAL'
                          check (regimen in ('GENERAL','RIMPE_EMPRENDEDOR','RIMPE_NEGOCIO_POPULAR')),
  obligado_contabilidad boolean not null default false,
  agente_retencion      boolean not null default false,
  contribuyente_especial boolean not null default false,
  -- Periodicidad de la declaración de IVA (formulario 104)
  periodicidad_iva      text not null default 'MENSUAL'
                          check (periodicidad_iva in ('MENSUAL','SEMESTRAL')),
  direccion             text,
  telefono              text,
  email                 text,
  activo                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, ruc)
);

create index if not exists idx_entidades_user on public.entidades(user_id);

-- ---------------------------------------------------------------------
-- Plan de cuentas
-- ---------------------------------------------------------------------
create table if not exists public.plan_cuentas (
  id            uuid primary key default gen_random_uuid(),
  entidad_id    uuid not null references public.entidades(id) on delete cascade,
  codigo        text not null,
  nombre        text not null,
  -- Clasificación para estados financieros
  tipo          text not null
                  check (tipo in ('ACTIVO','PASIVO','PATRIMONIO','INGRESO','COSTO','GASTO','ORDEN')),
  subtipo       text,   -- p.ej. ACTIVO_CORRIENTE, PASIVO_NO_CORRIENTE, GASTO_OPERATIVO
  naturaleza    char(1) not null check (naturaleza in ('D','C')),
  padre_id      uuid references public.plan_cuentas(id) on delete restrict,
  nivel         int not null default 1,
  -- Solo las cuentas de movimiento admiten asientos
  es_movimiento boolean not null default true,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (entidad_id, codigo)
);

create index if not exists idx_plan_cuentas_entidad on public.plan_cuentas(entidad_id);
create index if not exists idx_plan_cuentas_padre   on public.plan_cuentas(padre_id);
create index if not exists idx_plan_cuentas_tipo    on public.plan_cuentas(entidad_id, tipo);

-- ---------------------------------------------------------------------
-- Terceros: proveedores, clientes, empleadores
-- ---------------------------------------------------------------------
create table if not exists public.terceros (
  id                  uuid primary key default gen_random_uuid(),
  entidad_id          uuid not null references public.entidades(id) on delete cascade,
  tipo_identificacion text not null default 'RUC'
                        check (tipo_identificacion in ('RUC','CEDULA','PASAPORTE','CONSUMIDOR_FINAL','IDENT_EXTERIOR')),
  identificacion      text not null,
  razon_social        text not null,
  nombre_comercial    text,
  -- Actividad económica declarada en el SRI (alimenta la clasificación)
  actividad           text,
  es_proveedor        boolean not null default false,
  es_cliente          boolean not null default false,
  es_empleador        boolean not null default false,
  parte_relacionada   boolean not null default false,
  email               text,
  telefono            text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (entidad_id, identificacion)
);

create index if not exists idx_terceros_entidad on public.terceros(entidad_id);
create index if not exists idx_terceros_ident   on public.terceros(entidad_id, identificacion);

-- ---------------------------------------------------------------------
-- Categorías de gasto — misma taxonomía que tributos-web
-- (ALIMENTACIÓN, GASOLINA, VIVIENDA, SALUD, EDUCACIÓN, ...)
-- ---------------------------------------------------------------------
create table if not exists public.categorias_gasto (
  id                uuid primary key default gen_random_uuid(),
  entidad_id        uuid not null references public.entidades(id) on delete cascade,
  nombre            text not null,
  -- Cuenta contable a la que se imputa el gasto
  cuenta_id         uuid references public.plan_cuentas(id) on delete set null,
  -- Rubro de gastos personales deducibles de Impuesto a la Renta.
  -- NULL = no es gasto personal deducible.
  rubro_personal    text check (rubro_personal in
                      ('VIVIENDA','EDUCACION','SALUD','ALIMENTACION','VESTIMENTA','TURISMO')),
  -- Deducible como gasto del negocio para IR
  deducible_negocio boolean not null default true,
  -- Da derecho a crédito tributario de IVA
  credito_iva       boolean not null default true,
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (entidad_id, nombre)
);

create index if not exists idx_categorias_entidad on public.categorias_gasto(entidad_id);

-- ---------------------------------------------------------------------
-- Mapa de clasificación aprendido: identificación/comercio → categoría.
-- Réplica del `classification_map` de tributos-web: una vez clasificado un
-- proveedor, todo comprobante suyo se clasifica igual automáticamente.
-- ---------------------------------------------------------------------
create table if not exists public.mapa_clasificacion (
  id             uuid primary key default gen_random_uuid(),
  entidad_id     uuid not null references public.entidades(id) on delete cascade,
  -- Clave de coincidencia: RUC del proveedor o patrón del comercio en el extracto
  tipo_clave     text not null default 'RUC' check (tipo_clave in ('RUC','COMERCIO')),
  clave          text not null,
  nombre_origen  text,
  actividad      text,
  categoria_id   uuid not null references public.categorias_gasto(id) on delete cascade,
  -- Confianza y trazabilidad del aprendizaje
  origen         text not null default 'MANUAL'
                   check (origen in ('MANUAL','IA','IMPORTADO')),
  confirmado     boolean not null default false,
  veces_usado    int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (entidad_id, tipo_clave, clave)
);

create index if not exists idx_mapa_entidad on public.mapa_clasificacion(entidad_id);
create index if not exists idx_mapa_clave   on public.mapa_clasificacion(entidad_id, tipo_clave, clave);

-- ---------------------------------------------------------------------
-- Parámetros fiscales por año. Editables: las cifras del SRI cambian
-- cada ejercicio, por eso no se codifican en la aplicación.
-- ---------------------------------------------------------------------
create table if not exists public.parametros_fiscales (
  id                          uuid primary key default gen_random_uuid(),
  anio                        int not null unique,
  fraccion_basica_desgravada  numeric(14,2) not null,
  canasta_basica              numeric(14,2) not null,
  -- Tope de gastos personales expresado en número de canastas básicas
  topes_gastos_personales     jsonb not null default '{}'::jsonb,
  -- Porcentaje de rebaja por gastos personales (18% / 20% según cargas)
  porcentaje_rebaja_gp        numeric(6,4) not null default 0.18,
  -- Tabla progresiva de Impuesto a la Renta de personas naturales
  tabla_ir                    jsonb not null default '[]'::jsonb,
  -- Tarifas de IVA vigentes en el ejercicio
  tarifas_iva                 numeric(6,2)[] not null default '{0,5,8,15}',
  notas                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['entidades','terceros','mapa_clasificacion','parametros_fiscales']
  loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end $$;
