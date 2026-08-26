-- ============================================================
-- 0041 — Filtros por indicador en alumni_filtrados (drill-down de los KPIs).
--
-- Los KPIs del panel Alumni (Con correo, Con celular, Verificados, Pendientes
-- de revision, Con cuenta) deben poder abrirse como listado y exportarse. Se
-- anaden cinco filtros booleanos a nivel de PERSONA. La app solo envia true
-- (o null = no filtra), asi que la forma "p_x is null or <condicion>" basta.
--
-- Como cambia la firma (mas argumentos), hay que DROP + CREATE: create or
-- replace no puede anadir parametros. Idempotente: el drop usa if exists sobre
-- la firma anterior (10 args) y no falla si aun no existe.
-- ============================================================

drop function if exists alumni_filtrados(text, text, text, int, text, text, text, text, int, int);

create or replace function alumni_filtrados(
  p_genero      text    default null,
  p_facultad    text    default null,
  p_carrera     text    default null,
  p_anio        int     default null,
  p_nivel       text    default null,
  p_ocupacion   text    default null,
  p_instituto   text    default null,
  p_q           text    default null,
  p_con_email   boolean default null,
  p_con_celular boolean default null,
  p_verificado  boolean default null,
  p_pendiente   boolean default null,
  p_con_cuenta  boolean default null,
  p_limit       int     default 50,
  p_offset      int     default 0
)
returns table (
  id                   bigint,
  cedula               text,
  nombres              text,
  apellidos            text,
  genero               text,
  email                text,
  celular              text,
  telefono_fijo        text,
  ciudad               text,
  ocupacion            text,
  cargo                text,
  ocupacion_categoria  text,
  estado_verificacion  text,
  con_cuenta           boolean,
  titulo_reciente      text,
  n_titulos            bigint,
  total_count          bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtrados as (
    select
      a.id, a.cedula, a.nombres, a.apellidos, a.genero, a.email, a.celular,
      a.telefono_fijo, a.ciudad, a.ocupacion, a.cargo, a.ocupacion_categoria,
      a.estado_verificacion, a.profile_id,
      a.apellidos as ord_ap, a.nombres as ord_no
    from alumni a
    where
      (p_genero is null
        or (p_genero = 'sin datos' and a.genero is null)
        or a.genero = p_genero)
      and (p_ocupacion is null or a.ocupacion_categoria = p_ocupacion)
      and (p_con_email is null or a.email is not null)
      and (p_con_celular is null or a.celular is not null)
      and (p_verificado is null or a.estado_verificacion = 'verificado')
      and (p_pendiente is null or a.estado_verificacion = 'pendiente_revision')
      and (p_con_cuenta is null or a.profile_id is not null)
      and (p_q is null or p_q = ''
        or a.nombres ilike '%' || p_q || '%'
        or a.apellidos ilike '%' || p_q || '%'
        or a.cedula ilike '%' || p_q || '%'
        or a.email ilike '%' || p_q || '%')
      and (
        (p_facultad is null and p_carrera is null and p_anio is null
         and p_nivel is null and p_instituto is null)
        or exists (
          select 1
          from alumni_titulos t
          left join carreras c on c.id = t.carrera_id
          where t.alumni_id = a.id
            and (p_facultad is null
                 or (p_facultad = 'Sin asignar' and c.facultad is null)
                 or c.facultad = p_facultad)
            and (p_carrera is null
                 or (p_carrera = 'Sin asignar' and c.nombre is null)
                 or c.nombre = p_carrera)
            and (p_anio is null or t.anio_graduacion = p_anio)
            and (p_nivel is null
                 or (p_nivel = 'SIN DATOS' and t.nivel_formacion is null)
                 or t.nivel_formacion = p_nivel)
            and (p_instituto is null or t.instituto = p_instituto)
        )
      )
  )
  select
    f.id, f.cedula, f.nombres, f.apellidos, f.genero, f.email, f.celular,
    f.telefono_fijo, f.ciudad, f.ocupacion, f.cargo, f.ocupacion_categoria,
    f.estado_verificacion,
    (f.profile_id is not null) as con_cuenta,
    tt.titulo_reciente,
    tt.n_titulos,
    count(*) over() as total_count
  from filtrados f
  left join lateral (
    select
      (array_agg(t.titulo order by t.anio_graduacion desc nulls last))[1] as titulo_reciente,
      count(*) as n_titulos
    from alumni_titulos t
    where t.alumni_id = f.id
  ) tt on true
  order by f.ord_ap, f.ord_no
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;
