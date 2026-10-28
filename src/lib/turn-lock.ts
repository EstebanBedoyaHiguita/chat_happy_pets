/**
 * Un solo turno del bot a la vez por sala, y una sola respuesta por ráfaga.
 *
 * Hasta 2026-10-28 cada mensaje del cliente disparaba su propio runAgent en paralelo:
 * quien escribe "Hola" / "precio?" / "para perro" en tres mensajes recibía tres
 * respuestas, cada una sin saber de las otras, y a veces las dos primeras repetían lo
 * mismo. En la auditoría del 2026-10-26 fue la causa de los mensajes repetidos.
 *
 * Ahora:
 *  1. Cada mensaje espera BURST_MS. Si después llegó otro del cliente, este no responde:
 *     el último responde a todos juntos.
 *  2. El que responde toma el turno de la sala (`botLockUntil`, atómico). Si hay otro en
 *     curso, espera a que termine. El turno vence solo si la función se cae.
 *  3. Qué mensajes responde lo dice `botAnsweredUntil`: todos los del cliente posteriores.
 */
import type { Types } from 'mongoose'
import { Room } from './models/Room'
import { Message } from './models/Message'

/** Cuánto se espera a que el cliente termine de escribir. */
export const BURST_MS = 4_000
/** Más que el maxDuration de la función: si se cae a mitad del turno, se libera solo. */
const LOCK_TTL_MS = 75_000
/**
 * Cuánto espera un mensaje a que termine el turno en curso antes de rendirse. La función
 * vive 60 s: 4 de ráfaga + esta espera + su propio turno tienen que caber. Si se rinde,
 * el que tiene el turno lo responde al terminar (ver hayPendientes).
 */
const LOCK_WAIT_MS = 20_000
/** Máximo de mensajes del cliente que se responden juntos. */
const MAX_RAFAGA = 8

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type RoomId = Types.ObjectId | string

/** Espera la ráfaga. true si este sigue siendo el último mensaje del cliente. */
export async function esElUltimoDeLaRafaga(roomId: RoomId, messageId: RoomId): Promise<boolean> {
  await sleep(BURST_MS)
  const ultimo = await Message.findOne({ roomId, direction: 'inbound' })
    .sort({ timestamp: -1 })
    .select('_id')
    .lean<{ _id: Types.ObjectId }>()
  return !ultimo || String(ultimo._id) === String(messageId)
}

/** Toma el turno de la sala. false si otro no lo soltó a tiempo. */
export async function tomarTurno(roomId: RoomId, esperarMs = LOCK_WAIT_MS): Promise<boolean> {
  const limite = Date.now() + esperarMs
  for (;;) {
    const ahora = new Date()
    const r = await Room.updateOne(
      { _id: roomId, $or: [{ botLockUntil: null }, { botLockUntil: { $lt: ahora } }] },
      { $set: { botLockUntil: new Date(ahora.getTime() + LOCK_TTL_MS) } }
    )
    if (r.modifiedCount === 1) return true
    if (Date.now() >= limite) return false
    await sleep(1_000)
  }
}

export async function soltarTurno(roomId: RoomId): Promise<void> {
  await Room.updateOne({ _id: roomId }, { $set: { botLockUntil: null } })
}

/** ¿Hay mensajes del cliente sin responder? Lo que llegó mientras el turno respondía. */
export async function hayPendientes(roomId: RoomId): Promise<boolean> {
  const room = await Room.findById(roomId).select('botAnsweredUntil status').lean<{
    botAnsweredUntil?: Date | null
    status?: string
  }>()
  if (!room || room.status !== 'bot' || !room.botAnsweredUntil) return false
  return Boolean(
    await Message.exists({ roomId, direction: 'inbound', timestamp: { $gt: room.botAnsweredUntil } })
  )
}

export interface MensajeRafaga {
  _id: Types.ObjectId
  content: string
  timestamp: Date
  mediaType?: string
  mediaUrl?: string
}

/**
 * Los mensajes del cliente que este turno responde, y los marca como respondidos.
 * Sin `botAnsweredUntil` (salas anteriores a este cambio) cuenta desde el último saliente.
 */
export async function tomarRafaga(roomId: RoomId, answeredUntil?: Date | null): Promise<MensajeRafaga[]> {
  let desde = answeredUntil ?? null
  if (!desde) {
    const ultimoSaliente = await Message.findOne({ roomId, direction: 'outbound' })
      .sort({ timestamp: -1 })
      .select('timestamp')
      .lean<{ timestamp: Date }>()
    desde = ultimoSaliente?.timestamp ?? null
  }
  const rafaga = (
    await Message.find({ roomId, direction: 'inbound', ...(desde ? { timestamp: { $gt: desde } } : {}) })
      .sort({ timestamp: -1 })
      .limit(MAX_RAFAGA)
      .lean<MensajeRafaga[]>()
  ).reverse()
  if (rafaga.length > 0) {
    await Room.updateOne({ _id: roomId }, { $set: { botAnsweredUntil: rafaga[rafaga.length - 1].timestamp } })
  }
  return rafaga
}
