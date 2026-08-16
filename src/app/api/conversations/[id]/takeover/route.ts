import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'
import { Message } from '@/lib/models/Message'
import { AgentConfig } from '@/lib/models/AgentConfig'
import { cookies } from 'next/headers'
import { runAgent, RoomKnownData } from '@/lib/openai-agent'
import { sendChannelMessage, sendChannelImage, extractImageUrls } from '@/lib/whatsapp'
import { DEFAULT_TRANSFER_RULES } from '@/lib/transfer-rules'
import type { AgentProduct } from '@/lib/openai-agent'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  const cookieStore = await cookies()
  const agentName = cookieStore.get('agent_name')?.value ?? 'Asesor'

  const room = await Room.findById(id)
  if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  room.status = 'human'
  room.assignedTo = agentName
  room.unreadCount = 0
  await room.save()

  return NextResponse.json({ success: true, status: 'human', assignedTo: agentName })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  const room = await Room.findById(id)
  if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  room.status = 'bot'
  room.assignedTo = undefined
  await room.save()

  // Activate bot immediately with the client's last message as context
  waitUntil(resumeBot(id).catch(console.error))

  return NextResponse.json({ success: true, status: 'bot' })
}

async function resumeBot(roomId: string) {
  await connectDB()

  const room = await Room.findById(roomId)
  if (!room || room.status !== 'bot') return

  // Only respond if the last message is from the client — if the last message
  // is from the agent, wait for the client to write first
  const lastMessage = await Message.findOne({ roomId: room._id }).sort({ timestamp: -1 })
  if (!lastMessage || lastMessage.direction === 'outbound') return

  const lastInbound = lastMessage

  const history = await Message.find({ roomId: room._id })
    .sort({ timestamp: -1 })
    .limit(20)
    .then((msgs) => msgs.reverse())

  const outboundTexts = history.filter(m => m.direction === 'outbound').map(m => m.content.toLowerCase())
  const allTexts = history.map(m => m.content.toLowerCase())
  const orderSummaryShown = outboundTexts.some(t =>
    (t.includes('¿es correcto?') || t.includes('es correcto?')) &&
    t.includes('total') && t.includes('cop')
  )
  const snacksOffered = outboundTexts.some(t => t.includes('snack') || t.includes('deshidratado') || t.includes('galleta') || t.includes('premio'))

  const pendingSteps: string[] = []
  if (orderSummaryShown && !snacksOffered) {
    pendingSteps.push('OFRECER SNACKS: el cliente vio/eligió productos BARF pero aún no se le han ofrecido snacks. Cuando el cliente confirme el resumen del pedido ("sí, es correcto" o similar), lo PRIMERO que debes hacer es ofrecer snacks ANTES de pedir dirección, ciudad o cualquier otro dato.')
  }

  let config = await AgentConfig.findOne()
  if (!config) config = await AgentConfig.create({ transferRules: DEFAULT_TRANSFER_RULES })

  const roomData: RoomKnownData = {
    name: room.name,
    phone: room.phone || undefined,
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
    lastInbound.content,
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
    room.waId,
    roomData,
    undefined,
    pendingSteps.length > 0 ? pendingSteps : undefined
  )

  const { cleanText } = extractImageUrls(agentResponse.text)

  // En WhatsApp waId es el teléfono, o el BSUID si el usuario ocultó su número
  const recipientId = room.channel === 'whatsapp' ? (room.phone || room.waId) : room.phone

  if (agentResponse.products.length > 0) {
    for (const product of (agentResponse.products as AgentProduct[]).slice(0, 4)) {
      const caption = `${product.name}\n$${product.price.toLocaleString('es-CO')} COP\n${product.description}`
      const content = product.imageUrl ? `${product.imageUrl}\n${caption}` : caption
      let waMessageId: string | null = null
      if (product.imageUrl) {
        waMessageId = await sendChannelImage(room.channel, recipientId, product.imageUrl, caption)
      } else {
        waMessageId = await sendChannelMessage(room.channel, recipientId, caption)
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
    const waMessageId = await sendChannelMessage(room.channel, recipientId, cleanText)
    await Message.create({
      roomId: room._id,
      direction: 'outbound',
      sender: 'bot',
      content: cleanText,
      waMessageId: waMessageId ?? undefined,
      timestamp: new Date(),
    })
  }

  room.lastMessage = agentResponse.text
  room.lastMessageAt = new Date()

  if (agentResponse.transfer) {
    room.status = 'human'
  }
  if (agentResponse.orderCreated) {
    room.status = 'closed'
    room.closeReasonName = 'Pedido realizado'
    room.closedBy = 'bot'
  }

  await room.save()
}
