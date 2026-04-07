import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'
import { Message } from '@/lib/models/Message'
import { AgentConfig } from '@/lib/models/AgentConfig'
import { parseWebhookPayload, sendWhatsAppMessage, sendWhatsAppImage, extractImageUrls } from '@/lib/whatsapp'
import { runAgent, summarizeHistory } from '@/lib/openai-agent'
import { checkKeywordRules, DEFAULT_TRANSFER_RULES } from '@/lib/transfer-rules'

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
  processMessage(parsed).catch(console.error)
  return NextResponse.json({ status: 'ok' }, { status: 200 })
}

async function processMessage(parsed: {
  from: string
  name: string
  text: string
  messageId: string
  timestamp: string
}) {
  await connectDB()

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

  // Get last 6 messages for context
  const history = await Message.find({ roomId: room._id }).sort({ timestamp: 1 }).limit(6)

  // Run AI agent
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
    parsed.from
  )

  // Extract images from response and send text + images separately
  const { cleanText, imageUrls } = extractImageUrls(agentResponse.text)
  const waMessageId = await sendWhatsAppMessage(parsed.from, cleanText)
  for (const url of imageUrls) {
    await sendWhatsAppImage(parsed.from, url)
  }
  await Message.create({
    roomId: room._id,
    direction: 'outbound',
    sender: 'bot',
    content: cleanText,
    waMessageId: waMessageId ?? undefined,
    timestamp: new Date(),
  })

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

  await room.save()
}
