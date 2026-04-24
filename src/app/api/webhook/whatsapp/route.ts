import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'
import { Message } from '@/lib/models/Message'
import { AgentConfig } from '@/lib/models/AgentConfig'
import { parseWebhookPayload, sendWhatsAppMessage, sendWhatsAppImage, extractImageUrls, markWhatsAppMessageRead } from '@/lib/whatsapp'
import { runAgent, summarizeHistory, RoomKnownData, AgentProduct } from '@/lib/openai-agent'
import { checkKeywordRules, DEFAULT_TRANSFER_RULES } from '@/lib/transfer-rules'
import type { RoomDoc } from '@/lib/models/Room'
import type { Document } from 'mongoose'

async function autoExtractAndSave(room: RoomDoc & Document, text: string) {
  const update: Record<string, string> = {}

  // Pet type: perro/gato
  if (!room.petType) {
    if (/\b(perro|perrita|cachorro|can)\b/i.test(text)) update.petType = 'Perro'
    else if (/\b(gato|gatita|gatito|felino)\b/i.test(text)) update.petType = 'Gato'
  }

  // Age: "tiene 8 años", "8 años"
  const ageMatch = text.match(/(\d+)\s*a[ñn]os?/i)
  if (ageMatch && !room.petAge) update.petAge = `${ageMatch[1]} años`

  // Weight: "pesa 30 kg", "30 kilos", "30kg"
  const weightMatch = text.match(/(\d+(?:[.,]\d+)?)\s*k(?:g|ilos?)/i)
  if (weightMatch && !room.petWeight) update.petWeight = `${weightMatch[1]} kg`

  if (Object.keys(update).length > 0) {
    await Room.updateOne({ _id: room._id }, { $set: update })
    Object.assign(room, update)
  }
}

// GET: Meta webhook verification
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

// POST: Receive incoming messages
export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = parseWebhookPayload(body)
  if (!parsed) return NextResponse.json({ status: 'ignored' }, { status: 200 })
  waitUntil(processMessage(parsed).catch(console.error))
  return NextResponse.json({ status: 'ok' }, { status: 200 })
}

async function processMessage(parsed: {
  from: string
  name: string
  text: string
  messageId: string
  timestamp: string
}) {
  // Mark as read immediately so the client sees ✓✓ azules mientras el agente procesa
  markWhatsAppMessageRead(parsed.messageId)

  await connectDB()

  // Deduplicate: ignore already-processed messages
  const existing = await Message.findOne({ waMessageId: parsed.messageId })
  if (existing) return

  // Get or create room
  let room = await Room.findOne({ waId: parsed.from })
  if (!room) {
    room = await Room.create({
      waId: parsed.from,
      name: parsed.name,
      phone: parsed.from,
      status: 'bot',
      lastMessage: parsed.text,
      lastMessageAt: new Date(),
      windowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
  } else {
    room.lastMessage = parsed.text
    room.lastMessageAt = new Date()
    room.windowExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    room.unreadCount += 1
    if (room.name === 'Desconocido' && parsed.name !== 'Desconocido') {
      room.name = parsed.name
    }
    await room.save()
  }

  // Save incoming message
  await Message.create({
    roomId: room._id,
    direction: 'inbound',
    sender: 'user',
    content: parsed.text,
    waMessageId: parsed.messageId,
    timestamp: new Date(),
  })

  // Auto-extract pet data from client message and save to room
  await autoExtractAndSave(room, parsed.text)

  // If closed and client writes again, reactivate to bot
  if (room.status === 'closed') {
    room.status = 'bot'
    room.closeReasonId = undefined
    room.closeReasonName = undefined
    room.closedBy = undefined
    room.windowExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    await room.save()
  }

  // If conversation is in human mode, don't respond
  if (room.status !== 'bot') return

  // Get agent config
  let config = await AgentConfig.findOne()
  if (!config) {
    config = await AgentConfig.create({ transferRules: DEFAULT_TRANSFER_RULES })
  }

  // Check keyword transfer rules
  const keywordCheck = checkKeywordRules(parsed.text, config.transferRules)
  if (keywordCheck.triggered) {
    room.status = 'human'
    await room.save()
    await sendWhatsAppMessage(parsed.from, 'En este momento te voy a conectar con un asesor humano. Por favor espera un momento. 🙏')
    return
  }

  // Get last 10 messages for context (most recent, in chronological order)
  const history = await Message.find({ roomId: room._id })
    .sort({ timestamp: -1 })
    .limit(10)
    .then((msgs) => msgs.reverse())

  // Run AI agent
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
    parsed.text,
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
    roomData
  )

  // Strip any image syntax from bot text
  const { cleanText } = extractImageUrls(agentResponse.text)

  let waMessageId: string | null = null

  if (agentResponse.products.length > 0) {
    // Send each product as image with caption (max 2 per message per prompt instructions)
    for (const product of (agentResponse.products as AgentProduct[]).slice(0, 2)) {
      const caption = `${product.name}\n$${product.price.toLocaleString('es-CO')} COP\n${product.description}`
      const content = product.imageUrl ? `${product.imageUrl}\n${caption}` : caption
      if (product.imageUrl) {
        waMessageId = await sendWhatsAppImage(parsed.from, product.imageUrl, caption)
      } else {
        waMessageId = await sendWhatsAppMessage(parsed.from, caption)
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
    // No products — send text normally
    waMessageId = await sendWhatsAppMessage(parsed.from, cleanText)
    await Message.create({
      roomId: room._id,
      direction: 'outbound',
      sender: 'bot',
      content: cleanText,
      waMessageId: waMessageId ?? undefined,
      timestamp: new Date(),
    })
  }

  // Update summary in background if conversation is getting long
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

  // Update room last message
  room.lastMessage = agentResponse.text
  room.lastMessageAt = new Date()

  // If agent signals transfer
  if (agentResponse.transfer) {
    room.status = 'human'
    await sendWhatsAppMessage(parsed.from, 'Te voy a conectar con un asesor para que te ayude mejor. ¡Ya te atienden! 🙏')
  }

  // Close conversation automatically after a successful order
  if (agentResponse.orderCreated) {
    room.status = 'closed'
    room.closeReasonName = 'Pedido realizado'
    room.closedBy = 'bot'
  }

  await room.save()
}
