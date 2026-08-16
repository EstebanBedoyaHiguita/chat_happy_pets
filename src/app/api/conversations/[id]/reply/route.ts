import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'
import { Message } from '@/lib/models/Message'
import { sendChannelMessage, channelRecipientId } from '@/lib/whatsapp'
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

  const room = await Room.findById(id)
  if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const channel = (room.channel ?? 'whatsapp') as 'whatsapp' | 'messenger' | 'instagram'
  const recipientId = channelRecipientId(room)
  const waMessageId = await sendChannelMessage(channel, recipientId, text)

  const message = await Message.create({
    roomId: room._id,
    direction: 'outbound',
    sender: 'human',
    content: text,
    waMessageId: waMessageId ?? undefined,
    timestamp: new Date(),
  })

  room.lastMessage = text
  room.lastMessageAt = new Date()
  room.assignedTo = agentName
  await room.save()

  return NextResponse.json(message)
}
