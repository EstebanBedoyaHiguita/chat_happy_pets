/**
 * Reglas de los mensajes de seguimiento automático (cron /api/cron/proactive), puras
 * para poder probarlas. Auditoría del 2026-10-26: 56 de 157 salieron de noche, el de las
 * 12 h les hablaba de "perritos" a clientes con gato, y algunos le decían "vi que quedaste
 * con dudas" a un cliente cuyo último mensaje el bot nunca respondió.
 */
import { speciesIn } from './product-display'

/** Retrasos desde el último mensaje del cliente: 1 h, 12 h y 23 h (antes de que cierre la ventana de 24 h). */
export const DELAYS_MS = [1, 12, 23].map((h) => h * 60 * 60 * 1000)

/** Horario en que se le escribe a un cliente sin que lo haya pedido, hora de Bogotá. */
const HORA_INICIO = 8
const HORA_FIN = 20

export function dentroDeHorario(now = new Date()): boolean {
  const hora = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', hour: 'numeric', hourCycle: 'h23' }).format(now)
  )
  return hora >= HORA_INICIO && hora < HORA_FIN
}

/** Qué etapa toca, o -1. La última cuyo retraso ya pasó y que no se ha enviado. */
export function etapaQueToca(elapsedMs: number, etapaActual: number): number {
  let etapa = -1
  for (let i = etapaActual; i < DELAYS_MS.length; i++) if (elapsedMs >= DELAYS_MS[i]) etapa = i
  return etapa
}

export interface ClienteProactivo {
  name?: string
  petName?: string
  petTypes: (string | undefined)[]
}

export function mensajeProactivo(etapa: number, c: ClienteProactivo): string {
  const nombre = c.name && c.name !== 'Desconocido' ? c.name.trim().split(/\s+/)[0] : ''
  const hola = nombre ? `¡Hola ${nombre}!` : '¡Hola!'
  const especies = new Set(c.petTypes.flatMap((t) => speciesIn(t)))
  const quienes =
    especies.size === 1 ? (especies.has('gato') ? 'gaticos' : 'perritos') : 'perros y gatos'
  const mascota = c.petName || 'tu peludo'

  if (etapa === 0) {
    return `${hola} 🐾 Vi que quedaste con dudas sobre la dieta BARF${c.petName ? ` para ${c.petName}` : ''}. ¿Hay algo puntual que pueda explicarte para ayudarte a decidir?`
  }
  if (etapa === 1) {
    return `${hola} Te cuento que muchos ${quienes} en Medellín ya comen BARF, y los cambios más frecuentes son digestión estable, pelaje brillante y más energía ✨ ¿Le damos esa oportunidad a ${mascota}?`
  }
  return `${hola} 😊 Si decides dar el paso, aquí estamos para acompañarte en todo el proceso, con domicilio hasta tu puerta 🚪`
}

/**
 * Solo se hace seguimiento si lo último fue NUESTRO: el cliente dejó de responder. Si lo
 * último es del cliente, el que no respondió fue el bot (una falla, o una sala que pasó
 * por un asesor), y un "vi que quedaste con dudas" ahí es absurdo.
 */
export function debeHacerSeguimiento(ultimoMensaje?: { direction: string } | null): boolean {
  return ultimoMensaje?.direction === 'outbound'
}
