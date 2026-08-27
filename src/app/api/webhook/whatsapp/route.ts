import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'
import { Customer } from '@/lib/models/Customer'
import { Message } from '@/lib/models/Message'
import { AgentConfig } from '@/lib/models/AgentConfig'
import { parseWebhookPayload, parseMessengerPayload, sendChannelMessage, sendChannelImage, extractImageUrls, markWhatsAppMessageRead, getWhatsAppAudioBuffer, getMetaUserProfile, channelRecipientId, type AdReferral } from '@/lib/whatsapp'
import { runAgent, summarizeHistory, transcribeAudio, RoomKnownData, AgentProduct } from '@/lib/openai-agent'
import { checkKeywordRules, DEFAULT_TRANSFER_RULES } from '@/lib/transfer-rules'
import type { RoomDoc, ChannelType } from '@/lib/models/Room'
import type { Document } from 'mongoose'

// El turno que crea un pedido encadena varias llamadas a OpenAI y al backend
// (catalogo, ciudades, costo de envio). Con el default de Vercel la funcion se
// quedaba sin tiempo y el cliente no recibia respuesta.
export const maxDuration = 60

async function autoExtractAndSave(room: RoomDoc & Document, text: string) {
  const update: Record<string, string> = {}

  if (!room.petType) {
    if (/\b(perro|perrita|cachorro|can)\b/i.test(text)) update.petType = 'Perro'
    else if (/\b(gato|gatita|gatito|felino)\b/i.test(text)) update.petType = 'Gato'
  }

  // Extract pet name: capitalized word(s) at start of message before "tiene", "pesa", "es" or a comma
  if (!room.petName) {
    const nameMatch = text.match(/^([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{1,20}(?:\s[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{1,20})?)(?:\s*,|\s+tiene|\s+pesa|\s+es\s)/i)
    if (nameMatch) update.petName = nameMatch[1]
  }

  const ageMatch = text.match(/(\d+)\s*a[ñn]os?/i)
  if (ageMatch && !room.petAge) update.petAge = `${ageMatch[1]} años`

  const weightMatch = text.match(/(\d+(?:[.,]\d+)?)\s*k(?:g|ilos?)/i)
  if (weightMatch && !room.petWeight) update.petWeight = `${weightMatch[1]} kg`

  if (Object.keys(update).length > 0) {
    await Room.updateOne({ _id: room._id }, { $set: update })
    await Customer.findOneAndUpdate(
      { waId: room.waId },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
    Object.assign(room, update)
  }
}

// GET: Meta webhook verification (works for all 3 channels)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

// POST: Receive incoming messages from WhatsApp, Messenger or Instagram
export async function POST(req: NextRequest) {
  const body = await req.json()

  // Detect channel by object field
  const object = body.object as string

  let parsed
  if (object === 'whatsapp_business_account') {
    parsed = parseWebhookPayload(body)
  } else if (object === 'page' || object === 'instagram') {
    parsed = parseMessengerPayload(body)
  } else {
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }

  if (!parsed) return NextResponse.json({ status: 'ignored' }, { status: 200 })
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`
  waitUntil(processMessage(parsed, baseUrl).catch(console.error))
  return NextResponse.json({ status: 'ok' }, { status: 200 })
}

const UNSUPPORTED_MEDIA_MSG = 'Lo siento, por el momento no puedo procesar este tipo de mensaje. ¿Podrías escribirme en texto lo que necesitas? 😊'

async function processMessage(parsed: {
  from: string
  phone?: string
  userId?: string
  username?: string
  name: string
  text: string
  messageId: string
  timestamp: string
  channel: ChannelType
  mediaType?: 'image' | 'audio' | 'video'
  mediaId?: string
  mediaUrl?: string
  referral?: AdReferral
}, baseUrl = '') {
  // Mark as read (WhatsApp only — Messenger/Instagram mark read via different API)
  if (parsed.channel === 'whatsapp') markWhatsAppMessageRead(parsed.messageId)

  await connectDB()

  // Deduplicate
  const existing = await Message.findOne({ waMessageId: parsed.messageId })
  if (existing) return

  // Get or create room — key is channel:senderId to allow same person on multiple channels
  // En WhatsApp la clave es el teléfono cuando viene; si el usuario ocultó su número con
  // username, se usa el BSUID que Meta envía en su lugar.
  const roomKey = parsed.channel === 'whatsapp' ? parsed.from : `${parsed.channel}:${parsed.from}`
  let room = await Room.findOne({ waId: roomKey })
  // Conversación abierta antes con teléfono y que ahora llega solo con BSUID (o al revés)
  if (!room && parsed.userId) room = await Room.findOne({ waUserId: parsed.userId })
  const adFields = parsed.referral ? {
    adSource: parsed.referral.sourceType ?? 'ad',
    adId: parsed.referral.sourceId,
    adTitle: parsed.referral.adTitle ?? parsed.referral.headline,
    adBody: parsed.referral.body,
    ctwaClid: parsed.referral.ctwaClid,
    sourceUrl: parsed.referral.sourceUrl,
  } : { adSource: 'Organic' }

  if (!room) {
    room = await Room.create({
      waId: roomKey,
      channel: parsed.channel,
      name: parsed.name,
      // phone SOLO guarda teléfonos reales. En Instagram/Messenger no hay, y el IGSID/PSID
      // no puede ocupar su lugar: el pedido necesita un celular de verdad para la entrega.
      phone: parsed.phone ?? '',
      waUserId: parsed.userId,
      username: parsed.username,
      status: 'bot',
      lastMessage: parsed.text,
      lastMessageAt: new Date(),
      lastInboundAt: new Date(),
      windowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      proactiveStage: 0,
      ...adFields,
    })
    await Customer.findOneAndUpdate(
      { waId: roomKey },
      { $setOnInsert: { name: parsed.name, phone: parsed.phone ?? '', ...adFields } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  } else {
    room.lastMessage = parsed.text
    room.lastMessageAt = new Date()
    room.lastInboundAt = new Date()
    room.windowExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    room.unreadCount += 1
    room.proactiveStage = 0
    if (room.name === 'Desconocido' && parsed.name !== 'Desconocido') room.name = parsed.name
    // Completar identidad que Meta pueda haber agregado después (BSUID / username / teléfono)
    if (parsed.userId && !room.waUserId) room.waUserId = parsed.userId
    if (parsed.username && room.username !== parsed.username) room.username = parsed.username
    if (parsed.phone && !room.phone) room.phone = parsed.phone
    await room.save()
  }

  // Instagram y Messenger no mandan el nombre en el webhook, solo el ID del remitente.
  // Se consulta a la API de perfil antes de responder para que el saludo lo incluya.
  if (parsed.channel !== 'whatsapp' && (!room.name || room.name === 'Desconocido')) {
    const profile = await getMetaUserProfile(parsed.channel, parsed.from)
    const profileName = profile?.name || profile?.username
    if (profileName) {
      room.name = profileName
      if (profile?.username) room.username = profile.username
      await room.save()
      await Customer.updateOne({ waId: room.waId }, { $set: { name: profileName } })
    }
  }

  // Clave de la sala: la del documento (puede diferir de roomKey si la sala se encontró por BSUID).
  const replyTo = channelRecipientId(room)
  const roomWaId = room.waId

  // mediaUrl = URL stored in DB for display in chat (proxy endpoint)
  // visionUrl = base64 data URL sent to GPT-4o Vision (OpenAI can't access private endpoints)
  let mediaUrl: string | undefined
  let visionUrl: string | undefined
  let audioTranscription: string | undefined

  if (parsed.mediaType === 'image') {
    if (parsed.mediaId) {
      mediaUrl = `/api/media/${parsed.mediaId}`
      visionUrl = baseUrl ? `${baseUrl}/api/media/${parsed.mediaId}` : undefined
    } else if (parsed.mediaUrl) {
      mediaUrl = parsed.mediaUrl
      visionUrl = parsed.mediaUrl
    }
  }

  if (parsed.mediaType === 'audio' && parsed.mediaId) {
    mediaUrl = `/api/media/${parsed.mediaId}`
    const audioData = await getWhatsAppAudioBuffer(parsed.mediaId)
    if (audioData) {
      audioTranscription = (await transcribeAudio(audioData.buffer, audioData.mimeType)) ?? undefined
    }
  }

  if (parsed.mediaType === 'video' && parsed.mediaId) {
    mediaUrl = `/api/media/${parsed.mediaId}`
  }

  const inboundContent = parsed.mediaType === 'image'
    ? `[Imagen${parsed.text ? `: ${parsed.text}` : ''}]`
    : parsed.mediaType === 'audio'
      ? audioTranscription ?? '[Audio]'
      : parsed.mediaType === 'video'
        ? '[Video]'
        : parsed.text

  await Message.create({
    roomId: room._id,
    direction: 'inbound',
    sender: 'user',
    content: inboundContent,
    waMessageId: parsed.messageId,
    mediaType: parsed.mediaType,
    mediaUrl: mediaUrl,
    timestamp: new Date(),
  })

  const textForAgent = parsed.mediaType === 'audio' ? (audioTranscription ?? '') : (parsed.text ?? '')
  await autoExtractAndSave(room, textForAgent)

  if (room.status === 'closed') {
    room.status = 'bot'
    room.closeReasonId = undefined
    room.closeReasonName = undefined
    room.closedBy = undefined
    room.windowExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    await room.save()
  }

  if (room.status !== 'bot') return

  // Video: canned response (bot can't interpret video, but it's stored for human agents)
  if (parsed.mediaType === 'video') {
    const waId = await sendChannelMessage(parsed.channel, replyTo, UNSUPPORTED_MEDIA_MSG)
    await Message.create({
      roomId: room._id,
      direction: 'outbound',
      sender: 'bot',
      content: UNSUPPORTED_MEDIA_MSG,
      waMessageId: waId ?? undefined,
      timestamp: new Date(),
    })
    room.lastMessage = UNSUPPORTED_MEDIA_MSG
    room.lastMessageAt = new Date()
    await room.save()
    return
  }

  // Audio without transcription: canned response
  if (parsed.mediaType === 'audio' && !audioTranscription) {
    const waId = await sendChannelMessage(parsed.channel, replyTo, UNSUPPORTED_MEDIA_MSG)
    await Message.create({
      roomId: room._id,
      direction: 'outbound',
      sender: 'bot',
      content: UNSUPPORTED_MEDIA_MSG,
      waMessageId: waId ?? undefined,
      timestamp: new Date(),
    })
    room.lastMessage = UNSUPPORTED_MEDIA_MSG
    room.lastMessageAt = new Date()
    await room.save()
    return
  }

  let config = await AgentConfig.findOne()
  if (!config) config = await AgentConfig.create({ transferRules: DEFAULT_TRANSFER_RULES })

  const keywordCheck = checkKeywordRules(parsed.text, config.transferRules)
  if (keywordCheck.triggered) {
    room.status = 'human'
    await room.save()
    await sendChannelMessage(parsed.channel, replyTo, 'En este momento te voy a conectar con un asesor humano. Por favor espera un momento. 🙏')
    return
  }

  const history = await Message.find({ roomId: room._id })
    .sort({ timestamp: -1 })
    .limit(20)
    .then((msgs) => msgs.reverse())

  // Detect pending flow steps so the agent doesn't skip them
  const outboundTexts = history.filter(m => m.direction === 'outbound').map(m => m.content.toLowerCase())
  const orderSummaryShown = outboundTexts.some(t =>
    (t.includes('¿es correcto?') || t.includes('es correcto?')) &&
    t.includes('total') && t.includes('cop')
  )
  const snacksOffered = outboundTexts.some(t => t.includes('snack') || t.includes('deshidratado') || t.includes('galleta') || t.includes('premio'))

  const pendingSteps: string[] = []

  const hasOutbound = outboundTexts.length > 0
  if (!hasOutbound) {
    const clientName = room.name && room.name !== 'Desconocido' ? room.name : ''
    pendingSteps.push(`SALUDO OBLIGATORIO — PRIMER MENSAJE: Tu respuesta DEBE comenzar EXACTAMENTE así antes de cualquier otra cosa: "¡Hola${clientName ? ` ${clientName}` : ''}! Soy Sara, asesora virtual de Happy Pets Family 🐾" — luego continúa respondiendo lo que el cliente necesita en el mismo mensaje. NO omitas este saludo bajo ninguna circunstancia.`)
  }

  if (orderSummaryShown && !snacksOffered) {
    pendingSteps.push('OFRECER SNACKS: el cliente vio/eligió productos BARF pero aún no se le han ofrecido snacks. Cuando el cliente confirme el resumen del pedido ("sí, es correcto" o similar), lo PRIMERO que debes hacer es ofrecer snacks ANTES de pedir dirección, ciudad o cualquier otro dato.')
  }

  const roomData: RoomKnownData = {
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

  const agentResponse = await runAgent(
    audioTranscription || parsed.text || (parsed.mediaType === 'image' ? 'El cliente envió una imagen.' : ''),
    history.map((m) => ({
      _id: m._id.toString(),
      roomId: m.roomId.toString(),
      conversationId: m.roomId.toString(),
      direction: m.direction,
      sender: m.sender,
      content: m.content,
      waMessageId: m.waMessageId,
      timestamp: m.timestamp.toISOString(),
      createdAt: m.createdAt?.toString() ?? '',
    })),
    config.systemPrompt,
    config.transferRules,
    config.aiModel,
    config.temperature,
    room.contextSummary ?? '',
    roomWaId,
    roomData,
    visionUrl,
    pendingSteps.length > 0 ? pendingSteps : undefined
  )

  const { cleanText } = extractImageUrls(agentResponse.text)
  // Si el agente se queda sin texto (herramienta fallida, respuesta vacia) el
  // cliente NO puede quedarse sin respuesta: siempre sale algo.
  const safeText = cleanText?.trim() || 'Dame un momentico que reviso bien tu solicitud y te confirmo 😊🐾'
  let waMessageId: string | null = null

  if (agentResponse.products.length > 0) {
    for (const product of (agentResponse.products as AgentProduct[]).slice(0, 4)) {
      const caption = `${product.name}\n$${product.price.toLocaleString('es-CO')} COP\n${product.description}`
      const content = product.imageUrl ? `${product.imageUrl}\n${caption}` : caption
      if (product.imageUrl) {
        waMessageId = await sendChannelImage(parsed.channel, replyTo, product.imageUrl, caption)
      } else {
        waMessageId = await sendChannelMessage(parsed.channel, replyTo, caption)
      }
      await Message.create({
        roomId: room._id,
        direction: 'outbound',
        sender: 'bot',
        content,
        waMessageId: waMessageId ?? undefined,
        timestamp: new Date(),
      })
    }
  } else {
    waMessageId = await sendChannelMessage(parsed.channel, replyTo, safeText)
    await Message.create({
      roomId: room._id,
      direction: 'outbound',
      sender: 'bot',
      content: safeText,
      waMessageId: waMessageId ?? undefined,
      timestamp: new Date(),
    })
  }

  Message.countDocuments({ roomId: room._id }).then((count) => {
    if (count > 6) {
      Message.find({ roomId: room._id })
        .sort({ timestamp: 1 })
        .then((allMsgs) => {
          const formatted = allMsgs.map((m) => ({
            _id: m._id.toString(),
            roomId: m.roomId.toString(),
            conversationId: m.roomId.toString(),
            direction: m.direction,
            sender: m.sender,
            content: m.content,
            waMessageId: m.waMessageId,
            timestamp: m.timestamp.toISOString(),
            createdAt: m.createdAt?.toString() ?? '',
          }))
          return summarizeHistory(formatted)
        })
        .then((summary) => {
          if (summary) Room.updateOne({ _id: room._id }, { contextSummary: summary }).catch(console.error)
        })
        .catch(console.error)
    }
  }).catch(console.error)

  room.lastMessage = agentResponse.text
  room.lastMessageAt = new Date()

  if (agentResponse.transfer) {
    room.status = 'human'
    // Motivos en los que el propio mensaje del agente ya le avisó al cliente que
    // lo pasa con un asesor: repetirlo aquí manda dos veces lo mismo.
    const reason = agentResponse.transferReason?.toLowerCase() ?? ''
    const yaAvisoElAgente = reason.includes('comprobante') || reason.includes('pedido pendiente')
    if (!yaAvisoElAgente) {
      await sendChannelMessage(parsed.channel, replyTo, 'Te voy a conectar con un asesor para que te ayude mejor. ¡Ya te atienden! 🙏')
    }
  }

  if (agentResponse.orderCreated) {
    room.status = 'closed'
    room.closeReasonName = 'Pedido realizado'
    room.closedBy = 'bot'
  }

  await room.save()
}
