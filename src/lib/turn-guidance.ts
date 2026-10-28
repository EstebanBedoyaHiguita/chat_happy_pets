/**
 * Lo que Sara debe tener presente en ESTE turno, calculado en código a partir del
 * historial y de los datos de la sala. Reemplaza a `pendingSteps`, que hasta 2026-10-28
 * se calculaba por separado en el webhook y en el takeover y BLOQUEABA create_order: un
 * cliente al que nunca se le ofrecieron snacks no podía comprar.
 *
 * Nada de esto bloquea. Lo que sí debe cumplirse para registrar un pedido (nombre,
 * celular, dirección, ciudad, precios) ya lo exige create_order en código; aquí solo se
 * le cuenta al modelo qué tiene y qué le falta, para que lo pida de forma natural y de
 * una vez, en lugar de seguir un guion paso a paso.
 */

import { direccionEsUtil } from './order-flow'

export interface TurnGuidanceInput {
  history: { direction: string; content: string }[]
  name?: string
  /** Celular ya normalizado (vacío si no hay uno válido). */
  phone?: string
  address?: string
}

/** El resumen previo al pedido: "Perfecto, entonces tu pedido sería: … ¿Es correcto?". */
const mostroResumen = (t: string) =>
  (t.includes('es correcto?') || t.includes('todo correcto?')) && t.includes('paquete')

const ofrecioSnacks = (t: string) =>
  t.includes('snack') || t.includes('deshidratado') || t.includes('galleta') || t.includes('premio')

export function turnGuidance(input: TurnGuidanceInput): string[] {
  const salientes = input.history
    .filter((m) => m.direction === 'outbound')
    .map((m) => m.content.toLowerCase())
  const guia: string[] = []

  if (salientes.length === 0) {
    const nombre = input.name && input.name !== 'Desconocido' ? ` ${input.name.split(' ')[0]}` : ''
    guia.push(
      `Es tu PRIMER mensaje a este cliente: empieza con "¡Hola${nombre}! Soy Sara, asesora virtual de Happy Pets Family 🐾" ` +
        'y en el mismo mensaje respóndele lo que necesita.'
    )
  }

  if (salientes.some(mostroResumen) && !salientes.some(ofrecioSnacks)) {
    guia.push(
      'Todavía no le has ofrecido snacks. Cuando confirme su pedido de dietas, ofrécele snacks UNA vez, ' +
        'de forma natural (deshidratados, snacks húmedos o galletas). Si no quiere, sigue sin insistir.'
    )
  }

  const tiene: string[] = []
  const falta: string[] = []
  ;(input.name && input.name !== 'Desconocido' ? tiene : falta).push('nombre')
  ;(input.phone ? tiene : falta).push('celular')
  if (direccionEsUtil(input.address)) {
    tiene.push('dirección (si no dice la ciudad o el municipio, pregúntalo para el costo del envío)')
  } else {
    falta.push('dirección exacta (con números, y apartamento si aplica)', 'ciudad o municipio')
  }
  guia.push(
    `PARA REGISTRAR UN PEDIDO necesitas: los productos con sus cantidades, nombre, celular, dirección y ciudad. ` +
      `${tiene.length ? `Ya tienes: ${tiene.join('; ')}. ` : ''}${falta.length ? `Te falta: ${falta.join('; ')}.` : 'Ya tienes todos los datos.'}\n` +
      'Pide lo que falte solo cuando el cliente ya sepa qué va a pedir, y pídelo junto en un mensaje amable, ' +
      'no como un formulario de una pregunta por mensaje. Nunca pidas algo que ya tienes.'
  )

  return guia
}
