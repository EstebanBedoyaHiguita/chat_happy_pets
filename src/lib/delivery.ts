/**
 * Fecha y mensaje de entrega de un pedido del bot.
 *
 * La fecha la pone el código, no el modelo: cuando el modelo la escribía la copiaba
 * del historial — a Nahomy le dijo "llegará el viernes 5 de junio" el 2026-10-02, y a
 * Ximena "el miércoles 30 de septiembre" el 2026-10-12 — o la resumía en "mañana".
 *
 * Reglas del negocio (Esteban, 2026-10-27): lo pedido antes de las 11 p. m. llega el
 * siguiente día hábil; no hay entregas domingos ni festivos; se entrega en la mañana
 * (8–12) o en la tarde (2–6) según cómo quede la ruta del domiciliario.
 */

const COLOMBIA_TZ = 'America/Bogota'

/** Desde esta hora (Bogotá) el pedido ya no alcanza a salir al día siguiente. */
export const DELIVERY_CUTOFF_HOUR = 23

// Festivos de Colombia. Hay que extender la lista antes de 2028.
const HOLIDAYS = new Set([
  '2026-01-01','2026-01-12','2026-03-23','2026-04-02','2026-04-03',
  '2026-05-01','2026-05-18','2026-06-08','2026-06-15','2026-06-29',
  '2026-07-20','2026-08-07','2026-08-17','2026-10-12','2026-11-02',
  '2026-11-16','2026-12-08','2026-12-25',
  '2027-01-01','2027-01-11','2027-03-22','2027-03-25','2027-03-26',
  '2027-05-01','2027-05-10','2027-05-31','2027-06-07','2027-06-28',
  '2027-07-20','2027-08-07','2027-08-16','2027-10-18','2027-11-01',
  '2027-11-15','2027-12-08','2027-12-25',
])

const DAY_NAMES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
const MONTH_NAMES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

/**
 * Día de entrega para un pedido hecho en `now`, como "martes 28 de octubre".
 *
 * Se trabaja con la fecha de Bogotá como día calendario (mediodía UTC), nunca con la
 * hora del servidor. La versión anterior convertía dos veces la zona horaria: entre la
 * medianoche y las 5 a. m. de Bogotá revisaba festivos y domingos sobre el día
 * equivocado y podía anunciar como día de entrega el mismo día del pedido.
 */
export function getDeliveryDate(now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: COLOMBIA_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  )

  const day = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12))
  day.setUTCDate(day.getUTCDate() + (Number(parts.hour) >= DELIVERY_CUTOFF_HOUR ? 2 : 1))

  const ymd = (d: Date) => d.toISOString().slice(0, 10)
  for (let i = 0; i < 14 && (day.getUTCDay() === 0 || HOLIDAYS.has(ymd(day))); i++) {
    day.setUTCDate(day.getUTCDate() + 1)
  }

  return `${DAY_NAMES[day.getUTCDay()]} ${day.getUTCDate()} de ${MONTH_NAMES[day.getUTCMonth()]}`
}

export function deliveryMessage(now: Date = new Date()): string {
  return (
    `📦 Tu pedido llegará el ${getDeliveryDate(now)}, en la mañana (8:00 a. m. a 12:00 m.) ` +
    'o en la tarde (2:00 a 6:00 p. m.): la franja depende de cómo quede armada la ruta ' +
    'del domiciliario ese día. No hacemos entregas los domingos ni festivos.'
  )
}

// Lo que el modelo escribe por su cuenta sobre la entrega o como despedida.
const MODEL_DELIVERY_LINE = /📦|tu pedido llegar|no realizamos entregas|no hacemos entregas/i
const MODEL_FAREWELL_LINE = /gracias por confiar en happy pets|aqu[ií] estaremos siempre|hasta pronto/i

/**
 * Mensaje del pedido recién creado, con la entrega puesta por el código.
 *
 * Quita la línea de entrega que haya escrito el modelo y la despedida: esta sobra en el
 * mismo mensaje que termina en "¿Cuál opción prefieres?" (pasó en Tavo, Estefania,
 * Nora y la sala de pruebas). La despedida va cuando el cliente elige cómo pagar.
 * La entrega se pone antes de la información de pago, para que la pregunta de pago
 * quede de última y sea lo que el cliente responde.
 */
export function withDeliveryMessage(text: string, now: Date = new Date()): string {
  const lines = text
    .split('\n')
    .filter((l) => !MODEL_DELIVERY_LINE.test(l) && !MODEL_FAREWELL_LINE.test(l))

  const entrega = deliveryMessage(now)
  const pago = lines.findIndex((l) => l.trim().startsWith('💳'))
  if (pago >= 0) lines.splice(pago, 0, entrega, '')
  else lines.push('', entrega)

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
