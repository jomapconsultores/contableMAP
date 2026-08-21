"use client";

import { useCallback, useEffect } from "react";

/** El sobre con el que responden todas las rutas de la API. */
export type Respuesta<T> = { ok: true; datos: T } | { ok: false; error: string };

/** Cualquier fallo, convertido en un Error con mensaje presentable. */
export const comoError = (e: unknown) =>
  e instanceof Error ? e : new Error("Error al cargar");

/**
 * Carga de datos de una página: la inicial y la que piden los botones.
 *
 * El trabajo va partido en dos: `pedir` obtiene los datos y no toca el estado;
 * `aplicar` los vuelca, ya dentro del callback de la promesa. La separación no
 * es capricho: fijar estado en el cuerpo de un efecto encadena renderizaciones
 * —React avisa de ello— mientras que hacerlo cuando la respuesta llega es
 * justo el caso para el que están los efectos.
 *
 * Ambas funciones deben ser estables (`useCallback`). La identidad de `pedir`
 * es la que manda: si cambia porque cambió un filtro, se vuelve a pedir. Una
 * respuesta que llegue después de desmontar o de cambiar el filtro se
 * descarta, así que un filtro pulsado dos veces seguidas no puede dejar en
 * pantalla los datos del primero.
 *
 * Devuelve la función de recarga, para usarla desde un botón después de
 * guardar algo.
 */
export function useCarga<T>(
  pedir: () => Promise<T>,
  aplicar: (resultado: T | Error) => void,
): () => Promise<void> {
  useEffect(() => {
    let vigente = true;
    void pedir()
      .catch(comoError)
      .then((r) => {
        if (vigente) aplicar(r);
      });
    return () => {
      vigente = false;
    };
  }, [pedir, aplicar]);

  return useCallback(async () => {
    aplicar(await pedir().catch(comoError));
  }, [pedir, aplicar]);
}
