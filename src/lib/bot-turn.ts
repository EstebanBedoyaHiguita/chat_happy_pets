/**
 * Un turno del bot de punta a punta: arma lo que necesita runAgent, lo corre y le envía
 * la respuesta al cliente. Lo usan los dos lugares desde donde responde Sara: el webhook
 * (mensaje nuevo) y resumeBot (un asesor le devuelve la sala al bot).
 *
 * Hasta 2026-10-28 cada uno tenía su copia y se habían separado: el takeover no avisaba
 * la transferencia, no actualizaba el resumen y calculaba distinto el estado del flujo.
 * Quien llama se encarga del turno de la sala (turn-lock.ts) y de qué mensajes responde.
 */
import { Room, type RoomDoc } from './models/Room'
import { Message, type MessageDoc } from './models/Message'
import { AgentConfig } from './models/AgentConfig'
import { runAgent, summarizeHistory, type AgentProduct, type AgentResponse, type RoomKnownData } from './openai-agent'
import { sendChannelMessage, sendChannelImage, channelRecipientId } from './whatsapp'
import { buildOutgoingTexts } from './outgoing-text'
import { DEFAULT_TRANSFER_RULES } from './transfer-rules'
import type { IMessage } from '@/types'

/** Cuántos mensajes de la visita se le pasan al agente (él usa los últimos 16). */
const HISTORIAL = 20
const RELLENO = 'Dame un momentico que reviso bien tu solicitud y te confirmo 😊🐾'
const AVISO_TRANSFERENCIA = 'Te voy a conectar con un asesor para que te ayude mejor. ¡Ya te atienden! 🙏'

export interface TurnoDelBot {
  /** Lo que escribió el cliente: la ráfaga completa, o el último mensaje en resumeBot. */
  userMessage: string
  /** El historial termina antes de esto: el mensaje del cliente no va dos veces. */
  antesDe: Date
  visionUrl?: string
  quotedMessage?: string
}

export async function correrTurnoDelBot(room: RoomDoc, turno: TurnoDelBot): Promise<void> {
  let config = await AgentConfig.findOne()
  if (!config) config = await AgentConfig.create({ transferRules: DEFAULT_TRANSFER_RULES })

  const history = await historialDeLaVisita(room, turno.antesDe)
  const agentResponse = await runAgent(
    turno.userMessage,
    history,
    config.systemPrompt,
    config.transferRules,
    config.aiModel,
    config.temperature,
    room.contextSummary ?? '',
    room.waId,
    roomKnownData(room),
    turno.visionUrl,
    turno.quotedMessage
  )
  await enviarRespuesta(room, agentResponse)
}

export function roomKnownData(room: RoomDoc): RoomKnownData {
  return {
    name: room.name,
    phone: room.phone || undefined,
    channel: room.channel,
    petName: room.petName || undefined,
    petType: room.petType || undefined,
    petAge: room.petAge || undefined,
    petWeight: room.petWeight || undefined,
    pet2Name: room.pet2Name || undefined,
    pet2Type: room.pet2Type || undefined,
    pet2Age: room.pet2Age || undefined,
    pet2Weight: room.pet2Weight || undefined,
    pet3Name: room.pet3Name || undefined,
    pet3Type: room.pet3Type || undefined,
    pet3Age: room.pet3Age || undefined,
    pet3Weight: room.pet3Weight || undefined,
    address: room.address || undefined,
  }
}

/** Mensajes de la visita actual (ver Room.visitStartedAt), anteriores a `antesDe`. */
async function historialDeLaVisita(room: RoomDoc, antesDe: Date): Promise<IMessage[]> {
  const msgs = await Message.find({
    roomId: room._id,
    timestamp: { $lt: antesDe, ...(room.visitStartedAt ? { $gte: room.visitStartedAt } : {}) },
  })
    .sort({ timestamp: -1 })
    .limit(HISTORIAL)
  return msgs.reverse().map(aIMessage)
}

function aIMessage(m: MessageDoc): IMessage {
  return {
    _id: String(m._id),
    roomId: m.roomId.toString(),
    direction: m.direction,
    sender: m.sender,
    content: m.content,
    waMessageId: m.waMessageId,
    timestamp: m.timestamp.toISOString(),
    // timestamps: true en el esquema; MessageDoc no lo declara.
    createdAt: (m as MessageDoc & { createdAt?: Date }).createdAt?.toString() ?? '',
  }
}

/**
 * Le envía la respuesta al cliente: el texto antes de las fotos, las tarjetas, y el texto
 * de después (ver outgoing-text.ts). Después actualiza el resumen de la visita y el
 * estado de la sala.
 */
async function enviarRespuesta(room: RoomDoc, agentResponse: AgentResponse): Promise<void> {
  const recipientId = channelRecipientId(room)
  const products = (agentResponse.products as AgentProduct[]).slice(0, 4)
  // El texto se corta por donde el agente puso las URLs: lo de antes sale primero, las
  // fotos llevan la información una sola vez en su pie, y lo de después sale al final.
  const { intro, cola } = buildOutgoingTexts(agentResponse.text, products.map((p) => p.imageUrl))
  // Si el agente se queda sin texto (herramienta fallida, respuesta vacía) el cliente
  // NO puede quedarse sin respuesta: siempre sale algo.
  const relleno = products.length === 0 && !intro && !cola ? RELLENO : ''

  const guardar = (content: string, waMessageId: string | null) =>
    Message.create({
      roomId: room._id,
      direction: 'outbound',
      sender: 'bot',
      content,
      waMessageId: waMessageId ?? undefined,
      timestamp: new Date(),
    })
  const sendText = async (text: string) => {
    if (!text) return
    await guardar(text, await sendChannelMessage(room.channel, recipientId, text))
  }

  await sendText(intro || relleno)

  for (const product of products) {
    const caption = `${product.name}\n$${product.price.toLocaleString('es-CO')} COP\n${product.description}`
    const content = product.imageUrl ? `${product.imageUrl}\n${caption}` : caption
    const waMessageId = product.imageUrl
      ? await sendChannelImage(room.channel, recipientId, product.imageUrl, caption)
      : await sendChannelMessage(room.channel, recipientId, caption)
    await guardar(content, waMessageId)
  }

  await sendText(cola)

  actualizarResumen(room)

  room.lastMessage = agentResponse.text
  room.lastMessageAt = new Date()

  if (agentResponse.transfer) {
    room.status = 'human'
    const isPaymentReceipt = agentResponse.transferReason?.toLowerCase().includes('comprobante')
    if (!isPaymentReceipt) await sendText(AVISO_TRANSFERENCIA)
  }

  if (agentResponse.orderCreated) {
    room.status = 'closed'
    room.closeReasonName = 'Pedido realizado'
    room.closedBy = 'bot'
  }

  await room.save()
}

/**
 * El resumen es solo de la visita actual: con el de visitas anteriores el bot citaba
 * pedidos y fechas viejas como si fueran de hoy. En segundo plano, sin esperarlo.
 */
function actualizarResumen(room: RoomDoc): void {
  const deEstaVisita = {
    roomId: room._id,
    ...(room.visitStartedAt ? { timestamp: { $gte: room.visitStartedAt } } : {}),
  }
  Message.countDocuments(deEstaVisita)
    .then(async (count) => {
      if (count <= 6) return
      const msgs = await Message.find(deEstaVisita).sort({ timestamp: 1 })
      const summary = await summarizeHistory(msgs.map(aIMessage))
      if (summary) await Room.updateOne({ _id: room._id }, { contextSummary: summary })
    })
    .catch(console.error)
}
