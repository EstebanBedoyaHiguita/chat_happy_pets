/**
 * Señales del flujo de pedido que se calculan en código, no se le piden al modelo.
 *
 * Existe por lo del 2026-09-04: el cliente eligió Pescado y Res, dijo "No" a agregar
 * más sabores, y el bot saltó directo al resumen inventando "1 paquete" de cada uno.
 * La regla de preguntar la cantidad estaba escrita en el prompt y no la obedeció. Si
 * el cliente confirma ese resumen, se crea un pedido que nunca pidió.
 */

const normalizar = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const palabras = (t: string) => normalizar(t).split(' ').filter(Boolean)

/** Formas en que un cliente cierra la lista de sabores. */
const CIERRE = new Set([
  'no', 'nop', 'nel', 'ninguno', 'ninguna', 'nada', 'mas', 'listo', 'ya', 'eso',
  'solo', 'solamente', 'asi', 'esta', 'bien', 'gracias', 'ahi', 'ok', 'vale', 'esos', 'esas',
  // "solo ese", "esa nada más": faltaban y el cierre no se detectaba (2026-10-26).
  'ese', 'esa', 'este', 'estos', 'estas',
])

/** Números escritos. Se omiten "uno"/"una" a propósito: aparecen en habla normal. */
const NUMEROS = new Set([
  'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'quince', 'veinte', 'docena', 'media',
])

/**
 * ¿El cliente acaba de cerrar la lista de sabores?
 *
 * Se exige que el mensaje sea CORTO y esté hecho solo de palabras de cierre. Así
 * "no" y "así está bien" entran, pero "no me gusta el pescado" o "no, mejor pollo"
 * no: esos son mensajes con contenido propio y el turno no es un cierre.
 */
export function cierraListaDeSabores(userMessage: string): boolean {
  const ws = palabras(userMessage)
  if (ws.length === 0 || ws.length > 3) return false
  if (ws.some((w) => /\d/.test(w))) return false
  return ws.some((w) => CIERRE.has(w)) && ws.every((w) => CIERRE.has(w))
}

/**
 * ¿Ya se le mostró al menos un producto y el cliente todavía NO ha dicho cantidades?
 *
 * "Mostró" = salió una foto (un mensaje saliente con URL). "Dijo cantidades" = algún
 * mensaje entrante trae un número. Errar hacia el NO es lo seguro: se pierde el
 * recordatorio, no se rompe nada.
 */
export function faltanCantidades(historial: { direction: string; content: string }[]): boolean {
  const primeraFoto = historial.findIndex(
    (m) => m.direction === 'outbound' && m.content.includes('http')
  )
  if (primeraFoto === -1) return false
  // Solo cuenta lo que dijo después de ver productos: antes habla de su mascota.
  const dijoCantidad = historial
    .slice(primeraFoto)
    .some((m) => m.direction === 'inbound' && traeCantidad(m.content))
  return !dijoCantidad
}

/** Lo que va después de un número cuando NO es una cantidad de paquetes. */
const UNIDADES = new Set([
  'kg', 'kgs', 'k', 'kilo', 'kilos', 'gr', 'grs', 'g', 'gramo', 'gramos', 'lb', 'libra', 'libras',
  'ano', 'anos', 'mes', 'meses', 'semana', 'semanas', 'dia', 'dias', 'cm', 'am', 'pm', 'h', 'hora', 'horas',
])

/** Una dirección trae números que no son cantidades ("Calle 10 # 5-20, apto 301"). */
const DIRECCION = /\b(calle|cll|cl|carrera|cra|kr|cr|avenida|av|diagonal|dg|transversal|tv|circular|apto|apartamento|barrio|torre|interior|int|manzana|mz)\b/

/**
 * ¿El mensaje dice cuántos paquetes quiere? "quiero 3 de res", "cinco de pollo", "un
 * paquete". No cuentan un peso ("pesa 15 kilos", que sí contaba hasta 2026-10-28), una
 * edad, una hora, una dirección ni un teléfono.
 */
export function traeCantidad(texto: string): boolean {
  const limpio = normalizar(texto)
  if (texto.includes('#') || DIRECCION.test(limpio)) return false
  const ws = limpio.split(' ').filter(Boolean)
  return ws.some((w, i) => {
    const sig = ws[i + 1] ?? ''
    if (/^\d+$/.test(w)) return w.length <= 3 && !UNIDADES.has(sig)
    if (/^\d+[a-z]+$/.test(w)) return !UNIDADES.has(w.replace(/^\d+/, ''))
    if (NUMEROS.has(w)) return !UNIDADES.has(sig)
    // "uno"/"una" no cuentan solos (habla normal), pero "un paquete" sí.
    if (['un', 'una', 'uno'].includes(w)) return /^(paquete|paquetes|bolsa|bolsas)$/.test(sig)
    return false
  })
}

/**
 * ¿La dirección sirve para entregar?
 *
 * El 2026-09-04 se creó el pedido WA-1788504118729 con `address: "Medellín"`: Sara
 * pidió la dirección, el cliente respondió "Si", y ella siguió preguntando la CIUDAD
 * y guardó la ciudad como dirección. Nadie puede entregar ahí.
 *
 * Una dirección colombiana real siempre trae número ("Cra 43 # 54-62", "Calle 10 #5-20"),
 * así que se exige: no vacía, distinta de la ciudad, y con al menos un dígito. Es
 * deliberadamente laxa — no valida el formato, solo que no sea basura.
 */
export function direccionEsUtil(address?: string, ciudad?: string): boolean {
  const dir = normalizar(address ?? '')
  if (!dir) return false
  if (!/\d/.test(dir)) return false

  // "Medellín" o "Medellín, Medellín": quitada la ciudad no queda nada que entregar.
  const city = normalizar(ciudad ?? '')
  if (city) {
    const sinCiudad = dir.split(' ').filter((w) => !city.split(' ').includes(w)).join(' ')
    if (!sinCiudad.trim() || !/\d/.test(sinCiudad)) return false
  }
  return true
}
