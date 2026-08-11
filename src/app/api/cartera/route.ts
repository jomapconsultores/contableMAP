import { contexto, manejar, ErrorPeticion } from "@/lib/api";
import { contabilizarCartera, contabilizarAbono } from "@/lib/contabilizacion";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CLASES = ["CXC", "CXP", "DOC_COBRAR", "DOC_PAGAR"];

/** Documentos de cartera con su antigüedad. */
export async function GET(request: Request) {
  return manejar(async () => {
    const url = new URL(request.url);
    const { sb, entidadId } = await contexto(url.searchParams.get("entidad_id"));

    let q = sb
      .from("v_cartera_antiguedad")
      .select("*")
      .eq("entidad_id", entidadId)
      .order("fecha_vencimiento", { ascending: true });

    if (url.searchParams.get("pendientes") !== "false") {
      q = q.in("estado", ["PENDIENTE", "PARCIAL"]);
    }

    const { data, error } = await q;
    if (error) throw new ErrorPeticion(error.message, 500);
    return data;
  });
}

/**
 * Registra un documento de cartera nacido fuera de una factura: un préstamo,
 * una letra, un pagaré. Se contabiliza en el acto salvo que se pida lo
 * contrario.
 */
export async function POST(request: Request) {
  return manejar(async () => {
    const b = (await request.json()) as Record<string, unknown>;
    const clase = String(b.clase ?? "");
    const nombre = String(b.nombre_tercero ?? "").trim();
    const descripcion = String(b.descripcion ?? "").trim();
    const monto = Number(b.monto_original);
    const emision = String(b.fecha_emision ?? "");
    const vencimiento = String(b.fecha_vencimiento ?? "");

    if (!CLASES.includes(clase)) throw new ErrorPeticion(`Clase no válida: ${clase}`);
    if (!nombre) throw new ErrorPeticion("Indica el nombre del tercero.");
    if (!descripcion) throw new ErrorPeticion("Indica una descripción.");
    if (!Number.isFinite(monto) || monto <= 0) {
      throw new ErrorPeticion("El monto debe ser mayor que cero.");
    }
    if (!emision || !vencimiento) {
      throw new ErrorPeticion("Indica las fechas de emisión y de vencimiento.");
    }
    if (vencimiento < emision) {
      throw new ErrorPeticion("El vencimiento no puede ser anterior a la emisión.");
    }

    const { sb, entidadId } = await contexto();

    const { data, error } = await sb
      .from("cartera")
      .insert({
        entidad_id: entidadId,
        clase,
        nombre_tercero: nombre,
        identificacion: b.identificacion ? String(b.identificacion) : null,
        descripcion,
        referencia: b.referencia ? String(b.referencia) : null,
        fecha_emision: emision,
        fecha_vencimiento: vencimiento,
        monto_original: monto,
        tasa_interes: b.tasa_interes ? Number(b.tasa_interes) : 0,
        cuenta_id: b.cuenta_id ? String(b.cuenta_id) : null,
        notas: b.notas ? String(b.notas) : null,
      })
      .select("id, clase, saldo")
      .single();

    if (error) throw new ErrorPeticion(error.message, 500);

    let asientoId: string | null = null;
    if (b.contabilizar !== false) {
      try {
        asientoId = await contabilizarCartera(sb, entidadId, data.id);
      } catch (e) {
        // El documento queda registrado aunque el asiento falle: es preferible
        // no perder el dato y avisar del problema contable.
        return {
          ...data,
          asiento_id: null,
          aviso: e instanceof Error ? e.message : "No se pudo contabilizar",
        };
      }
    }

    return { ...data, asiento_id: asientoId };
  });
}

/** Registra un abono (cobro o pago) y lo contabiliza. */
export async function PUT(request: Request) {
  return manejar(async () => {
    const b = (await request.json()) as Record<string, unknown>;
    const carteraId = String(b.cartera_id ?? "");
    const monto = Number(b.monto);
    const fecha = String(b.fecha ?? "");

    if (!carteraId) throw new ErrorPeticion("Falta el documento de cartera.");
    if (!Number.isFinite(monto) || monto <= 0) {
      throw new ErrorPeticion("El monto del abono debe ser mayor que cero.");
    }
    if (!fecha) throw new ErrorPeticion("Indica la fecha del abono.");

    const { sb, entidadId } = await contexto();

    const { data: doc } = await sb
      .from("cartera")
      .select("saldo, estado")
      .eq("id", carteraId)
      .maybeSingle();

    if (!doc) throw new ErrorPeticion("Documento no encontrado.", 404);
    if (doc.estado === "CANCELADO") throw new ErrorPeticion("El documento ya está cancelado.");
    if (monto > Number(doc.saldo)) {
      throw new ErrorPeticion(
        `El abono (${monto.toFixed(2)}) excede el saldo pendiente (${Number(doc.saldo).toFixed(2)}).`,
      );
    }

    const { data, error } = await sb
      .from("abonos")
      .insert({
        entidad_id: entidadId,
        cartera_id: carteraId,
        fecha,
        monto,
        interes: b.interes ? Number(b.interes) : 0,
        cuenta_financiera_id: b.cuenta_financiera_id ? String(b.cuenta_financiera_id) : null,
        forma_pago: b.forma_pago ? String(b.forma_pago) : null,
        referencia: b.referencia ? String(b.referencia) : null,
      })
      .select("id")
      .single();

    if (error) throw new ErrorPeticion(error.message, 500);

    const asientoId = await contabilizarAbono(sb, entidadId, data.id);

    const { data: actualizado } = await sb
      .from("cartera")
      .select("saldo, estado")
      .eq("id", carteraId)
      .single();

    return { id: data.id, asiento_id: asientoId, ...actualizado };
  });
}
