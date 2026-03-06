import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Conversation } from '@/lib/models/Conversation'
import { Message } from '@/lib/models/Message'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { cookies } from 'next/headers'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  const { text } = await req.json()
  const cookieStore = await cookies()
  const agentName = cookieStore.get('agent_name')?.value ?? 'Asesor'

  if (!text?.trim()) {
    return NextResponse.json({ error: 'Message text is required' }, { status: 400 })
  }

  const conversation = await Conversation.findById(id)
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const waMessageId = await sendWhatsAppMessage(conversation.waId, text)

  const message = await Message.create({
    conversationId: conversation._id,
    direction: 'outbound',
    sender: 'human',
    content: text,
    waMessageId: waMessageId ?? undefined,
    timestamp: new Date(),
  })

  conversation.lastMessage = text
  conversation.lastMessageAt = new Date()
  conversation.assignedTo = agentName
  await conversation.save()

  return NextResponse.json(message)
}
