-- =====================================================================
-- ContableMAP · 0011 · Facturación electrónica (SRI, esquema offline)
-- El emisor genera el XML, lo firma con su certificado y lo envía a los
-- web services de Recepción y Autorización. Aquí vive lo que hay que
-- persistir: configuración del emisor, secuenciales, detalle de la
-- factura y el rastro de cada envío.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuración del emisor electrónico. Una fila por entidad.
-- El certificado .p12 se guarda en el bucket privado `certificados`;
-- aquí solo queda su ruta, sus datos legibles y la contraseña cifrada
-- (AES-256-GCM con SRI_CERT_SECRET, que nunca sale del servidor).
-- ---------------------------------------------------------------------
create table if not exists public.sri_config (
  entidad_id            uuid primary key references public.entidades(id) on delete cascade,
  -- 1 = pruebas (celcer), 2 = producción (cel). Lo emitido en pruebas no tiene
  -- validez tributaria y así lo dice el RIDE.
  ambiente              smallint not null default 1 check (ambiente in (1,2)),
  -- 1 = emisión normal; es la única vigente desde que el SRI retiró la
  -- emisión por indisponibilidad del sistema.
  tipo_emision          smallint not null default 1 check (tipo_emision = 1),
  dir_matriz            text not null,
  -- Leyendas obligatorias en el XML cuando aplican
  num_resolucion_especial     text,
  agente_retencion_resolucion text,
  -- Contacto que aparece en el RIDE
  email_emisor          text,
  telefono_emisor       text,
  -- Certificado de firma
  cert_path             text,
  cert_password_cifrada text,
  cert_sujeto           text,
  cert_emisor           text,
  cert_serie            text,
  cert_desde            timestamptz,
  cert_hasta            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Establecimientos y puntos de emisión, con su secuencial.
-- El secuencial se entrega desde la base con `update ... returning`, que es
-- atómico: dos emisiones simultáneas nunca reciben el mismo número.
-- ---------------------------------------------------------------------
create table if not exists public.puntos_emision (
  id               uuid primary key default gen_random_uuid(),
  entidad_id       uuid not null references public.entidades(id) on delete cascade,
  establecimiento  char(3) not null check (establecimiento ~ '^[0-9]{3}$'),
  punto_emision    char(3) not null check (punto_emision ~ '^[0-9]{3}$'),
  nombre           text,
  direccion        text,
  -- Próximo número a emitir por tipo de comprobante
  sec_factura      int not null default 1 check (sec_factura between 1 and 999999999),
  sec_nota_credito int not null default 1 check (sec_nota_credito between 1 and 999999999),
  sec_retencion    int not null default 1 check (sec_retencion between 1 and 999999999),
  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (entidad_id, establecimiento, punto_emision)
);

create index if not exists idx_puntos_emision_entidad on public.puntos_emision(entidad_id);

-- Entrega el siguiente secuencial y lo reserva en la misma operación.
create or replace function public.sri_siguiente_secuencial(
  p_punto uuid,
  p_tipo  text default 'FACTURA'
) returns int
language plpgsql
security invoker
set search_path = public
as $fn$
declare v_sec int;
begin
  if p_tipo = 'FACTURA' then
    update public.puntos_emision set sec_factura = sec_factura + 1
     where id = p_punto returning sec_factura - 1 into v_sec;
  elsif p_tipo = 'NOTA_CREDITO' then
    update public.puntos_emision set sec_nota_credito = sec_nota_credito + 1
     where id = p_punto returning sec_nota_credito - 1 into v_sec;
  elsif p_tipo = 'RETENCION' then
    update public.puntos_emision set sec_retencion = sec_retencion + 1
     where id = p_punto returning sec_retencion - 1 into v_sec;
  else
    raise exception 'Tipo de comprobante sin secuencial: %', p_tipo;
  end if;

  if v_sec is null then
    raise exception 'El punto de emision no existe o no pertenece a la entidad.';
  end if;
  return v_sec;
end
$fn$;

-- ---------------------------------------------------------------------
-- Detalle de la venta. El XML del SRI exige línea a línea; el desglose por
-- tarifa que ya vive en `ventas` se calcula a partir de aquí.
-- ---------------------------------------------------------------------
create table if not exists public.venta_items (
  id                uuid primary key default gen_random_uuid(),
  venta_id          uuid not null references public.ventas(id) on delete cascade,
  orden             int not null default 1,
  codigo_principal  text not null,
  codigo_auxiliar   text,
  descripcion       text not null,
  cantidad          numeric(18,6) not null check (cantidad > 0),
  precio_unitario   numeric(18,6) not null check (precio_unitario >= 0),
  descuento         numeric(16,2) not null default 0 check (descuento >= 0),
  -- Tarifa de IVA aplicable a la línea
  tarifa            text not null default '15'
                      check (tarifa in ('0','5','8','15','NO_OBJETO','EXENTO')),
  base              numeric(16,2) not null default 0,
  iva               numeric(16,2) not null default 0,
  created_at        timestamptz not null default now(),
  unique (venta_id, orden)
);

create index if not exists idx_venta_items_venta on public.venta_items(venta_id);

-- ---------------------------------------------------------------------
-- Estado de la venta frente al SRI
-- ---------------------------------------------------------------------
alter table public.ventas
  add column if not exists punto_emision_id  uuid references public.puntos_emision(id) on delete set null,
  add column if not exists sri_ambiente      smallint check (sri_ambiente in (1,2)),
  add column if not exists sri_estado        text not null default 'NO_ELECTRONICA'
    check (sri_estado in ('NO_ELECTRONICA','GENERADA','FIRMADA','RECIBIDA',
                          'AUTORIZADA','DEVUELTA','NO_AUTORIZADA','ANULADA')),
  add column if not exists sri_fecha_autorizacion timestamptz,
  add column if not exists sri_mensajes      jsonb not null default '[]'::jsonb,
  add column if not exists sri_intentos      int not null default 0,
  add column if not exists xml_firmado_path  text,
  add column if not exists xml_autorizado_path text,
  add column if not exists codigo_numerico   char(8),
  add column if not exists forma_pago_sri    text,
  add column if not exists email_cliente     text,
  add column if not exists direccion_cliente text,
  add column if not exists telefono_cliente  text,
  add column if not exists propina           numeric(16,2) not null default 0;

-- La clave de acceso identifica el comprobante ante el SRI: única por entidad.
create unique index if not exists idx_ventas_clave_acceso
  on public.ventas(entidad_id, clave_acceso)
  where clave_acceso is not null;

create index if not exists idx_ventas_sri_estado on public.ventas(entidad_id, sri_estado);

-- ---------------------------------------------------------------------
-- Bitácora de envíos: qué se mandó, qué respondió el SRI y cuándo.
-- Es la prueba de la gestión ante una revisión, y lo que permite reintentar
-- la autorización sin volver a firmar.
-- ---------------------------------------------------------------------
create table if not exists public.sri_envios (
  id             uuid primary key default gen_random_uuid(),
  entidad_id     uuid not null references public.entidades(id) on delete cascade,
  venta_id       uuid references public.ventas(id) on delete cascade,
  clave_acceso   char(49) not null,
  ambiente       smallint not null check (ambiente in (1,2)),
  paso           text not null check (paso in ('RECEPCION','AUTORIZACION')),
  estado         text not null,
  mensajes       jsonb not null default '[]'::jsonb,
  duracion_ms    int,
  created_at     timestamptz not null default now()
);

create index if not exists idx_sri_envios_venta on public.sri_envios(venta_id, created_at desc);
create index if not exists idx_sri_envios_clave on public.sri_envios(clave_acceso);

-- ---------------------------------------------------------------------
-- RLS: mismo criterio que el resto del modelo
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sri_config','puntos_emision','sri_envios','venta_items']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['sri_config','puntos_emision','sri_envios']
  loop
    execute format('drop policy if exists %I on public.%I;', t || '_all', t);
    execute format($p$
      create policy %I on public.%I
        for all to authenticated
        using (public.fn_es_mi_entidad(entidad_id))
        with check (public.fn_es_mi_entidad(entidad_id));
    $p$, t || '_all', t);
  end loop;
end $$;

-- Los ítems heredan de su venta
drop policy if exists venta_items_all on public.venta_items;
create policy venta_items_all on public.venta_items
  for all to authenticated
  using (exists (
    select 1 from public.ventas v
     where v.id = venta_id and public.fn_es_mi_entidad(v.entidad_id)))
  with check (exists (
    select 1 from public.ventas v
     where v.id = venta_id and public.fn_es_mi_entidad(v.entidad_id)));

-- ---------------------------------------------------------------------
-- Storage: certificados y XML, ambos privados y con un prefijo por usuario
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('certificados', 'certificados', false), ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

drop policy if exists certificados_lectura on storage.objects;
create policy certificados_lectura on storage.objects
  for select to authenticated
  using (bucket_id = 'certificados' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists certificados_escritura on storage.objects;
create policy certificados_escritura on storage.objects
  for insert to authenticated
  with check (bucket_id = 'certificados' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists certificados_borrado on storage.objects;
create policy certificados_borrado on storage.objects
  for delete to authenticated
  using (bucket_id = 'certificados' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists comprobantes_lectura on storage.objects;
create policy comprobantes_lectura on storage.objects
  for select to authenticated
  using (bucket_id = 'comprobantes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists comprobantes_escritura on storage.objects;
create policy comprobantes_escritura on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comprobantes' and (storage.foldername(name))[1] = auth.uid()::text);
