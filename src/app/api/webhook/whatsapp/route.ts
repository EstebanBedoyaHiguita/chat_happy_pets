import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Conversation } from '@/lib/models/Conversation'
import { Message } from '@/lib/models/Message'
import { AgentConfig } from '@/lib/models/AgentConfig'
import { parseWebhookPayload, sendWhatsAppMessage } from '@/lib/whatsapp'
import { runAgent } from '@/lib/openai-agent'
import { checkKeywordRules } from '@/lib/transfer-rules'
import { DEFAULT_TRANSFER_RULES } from '@/lib/transfer-rules'

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

  // Always respond 200 quickly to Meta
  const parsed = parseWebhookPayload(body)
  if (!parsed) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }

  // Process in background (don't await - respond to Meta immediately)
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

  // Get or create conversation
  let conversation = await Conversation.findOne({ waId: parsed.from })
  if (!conversation) {
    conversation = await Conversation.create({
      waId: parsed.from,
      name: parsed.name,
      phone: parsed.from,
      status: 'bot',
      lastMessage: parsed.text,
      lastMessageAt: new Date(),
    })
  } else {
    conversation.lastMessage = parsed.text
    conversation.lastMessageAt = new Date()
    conversation.unreadCount += 1
    if (conversation.name === 'Desconocido' && parsed.name !== 'Desconocido') {
      conversation.name = parsed.name
    }
    await conversation.save()
  }

  // Save incoming message
  await Message.create({
    conversationId: conversation._id,
    direction: 'inbound',
    sender: 'user',
    content: parsed.text,
    waMessageId: parsed.messageId,
    timestamp: new Date(),
  })

  // If conversation is in human mode, don't respond
  if (conversation.status !== 'bot') return

  // Get agent config
  let config = await AgentConfig.findOne()
  if (!config) {
    config = await AgentConfig.create({
      transferRules: DEFAULT_TRANSFER_RULES,
    })
  }

  // Check keyword transfer rules before sending to AI
  const keywordCheck = checkKeywordRules(parsed.text, config.transferRules)
  if (keywordCheck.triggered) {
    conversation.status = 'human'
    conversation.lastMessage = parsed.text
    await conversation.save()
    await sendWhatsAppMessage(
      parsed.from,
      'En este momento te voy a conectar con un asesor humano. Por favor espera un momento. 🙏'
    )
    return
  }

  // Get conversation history for context
  const history = await Message.find({ conversationId: conversation._id })
    .sort({ timestamp: 1 })
    .limit(20)

  // Run AI agent
  const agentResponse = await runAgent(
    parsed.text,
    history.map((m) => ({
      _id: m._id.toString(),
      conversationId: m.conversationId.toString(),
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
    config.temperature
  )

  // Save bot response
  const waMessageId = await sendWhatsAppMessage(parsed.from, agentResponse.text)
  await Message.create({
    conversationId: conversation._id,
    direction: 'outbound',
    sender: 'bot',
    content: agentResponse.text,
    waMessageId: waMessageId ?? undefined,
    timestamp: new Date(),
  })

  // Update conversation last message
  conversation.lastMessage = agentResponse.text
  conversation.lastMessageAt = new Date()

  // If agent signals transfer
  if (agentResponse.transfer) {
    conversation.status = 'human'
    await sendWhatsAppMessage(
      parsed.from,
      'Te voy a conectar con un asesor para que te ayude mejor. ¡Ya te atienden! 🙏'
    )
  }

  await conversation.save()
}
