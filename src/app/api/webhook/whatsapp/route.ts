import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'
import { Customer } from '@/lib/models/Customer'
import { Message } from '@/lib/models/Message'
import { AgentConfig } from '@/lib/models/AgentConfig'
import { parseWebhookPayload, parseMessengerPayload, sendChannelMessage, sendChannelImage, extractImageUrls, markWhatsAppMessageRead, getWhatsAppAudioBuffer, type AdReferral } from '@/lib/whatsapp'
import { runAgent, summarizeHistory, transcribeAudio, RoomKnownData, AgentProduct } from '@/lib/openai-agent'
import { checkKeywordRules, DEFAULT_TRANSFER_RULES } from '@/lib/transfer-rules'
import type { RoomDoc, ChannelType } from '@/lib/models/Room'
import type { Document } from 'mongoose'

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
  const roomKey = parsed.channel === 'whatsapp' ? parsed.from : `${parsed.channel}:${parsed.from}`
  let room = await Room.findOne({ waId: roomKey })
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
      phone: parsed.from,
      status: 'bot',
      lastMessage: parsed.text,
      lastMessageAt: new Date(),
      windowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ...adFields,
    })
    await Customer.findOneAndUpdate(
      { waId: roomKey },
      { $setOnInsert: { name: parsed.name, phone: parsed.from, ...adFields } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  } else {
    room.lastMessage = parsed.text
    room.lastMessageAt = new Date()
    room.windowExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    room.unreadCount += 1
    if (room.name === 'Desconocido' && parsed.name !== 'Desconocido') room.name = parsed.name
    await room.save()
  }

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
    const waId = await sendChannelMessage(parsed.channel, parsed.from, UNSUPPORTED_MEDIA_MSG)
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
    const waId = await sendChannelMessage(parsed.channel, parsed.from, UNSUPPORTED_MEDIA_MSG)
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
    await sendChannelMessage(parsed.channel, parsed.from, 'En este momento te voy a conectar con un asesor humano. Por favor espera un momento. 🙏')
    return
  }

  const history = await Message.find({ roomId: room._id })
    .sort({ timestamp: -1 })
    .limit(20)
    .then((msgs) => msgs.reverse())

  // Detect pending flow steps so the agent doesn't skip them
  const outboundTexts = history.filter(m => m.direction === 'outbound').map(m => m.content.toLowerCase())
  const allTexts = history.map(m => m.content.toLowerCase())
  const barfDiscussed = allTexts.some(t => t.includes('barf') || t.includes('dieta') || t.includes('paquete') || t.includes('res') || t.includes('cordero') || t.includes('salmón') || t.includes('salmon'))
  const snacksOffered = outboundTexts.some(t => t.includes('snack') || t.includes('deshidratado') || t.includes('galleta') || t.includes('premio'))

  const pendingSteps: string[] = []
  if (barfDiscussed && !snacksOffered) {
    pendingSteps.push('OFRECER SNACKS: el cliente vio/eligió productos BARF pero aún no se le han ofrecido snacks. Cuando el cliente confirme el resumen del pedido ("sí, es correcto" o similar), lo PRIMERO que debes hacer es ofrecer snacks ANTES de pedir dirección, ciudad o cualquier otro dato.')
  }

  const roomData: RoomKnownData = {
    name: room.name,
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
    parsed.from,
    roomData,
    visionUrl,
    pendingSteps.length > 0 ? pendingSteps : undefined
  )

  const { cleanText } = extractImageUrls(agentResponse.text)
  let waMessageId: string | null = null

  if (agentResponse.products.length > 0) {
    for (const product of (agentResponse.products as AgentProduct[]).slice(0, 2)) {
      const caption = `${product.name}\n$${product.price.toLocaleString('es-CO')} COP\n${product.description}`
      const content = product.imageUrl ? `${product.imageUrl}\n${caption}` : caption
      if (product.imageUrl) {
        waMessageId = await sendChannelImage(parsed.channel, parsed.from, product.imageUrl, caption)
      } else {
        waMessageId = await sendChannelMessage(parsed.channel, parsed.from, caption)
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
    waMessageId = await sendChannelMessage(parsed.channel, parsed.from, cleanText)
    await Message.create({
      roomId: room._id,
      direction: 'outbound',
      sender: 'bot',
      content: cleanText,
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
    const isPaymentReceipt = agentResponse.transferReason?.toLowerCase().includes('comprobante')
    if (!isPaymentReceipt) {
      await sendChannelMessage(parsed.channel, parsed.from, 'Te voy a conectar con un asesor para que te ayude mejor. ¡Ya te atienden! 🙏')
    }
  }

  if (agentResponse.orderCreated) {
    room.status = 'closed'
    room.closeReasonName = 'Pedido realizado'
    room.closedBy = 'bot'
  }

  await room.save()
}
