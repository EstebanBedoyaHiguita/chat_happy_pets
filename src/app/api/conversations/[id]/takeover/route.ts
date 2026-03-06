import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Conversation } from '@/lib/models/Conversation'
import { cookies } from 'next/headers'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  const cookieStore = await cookies()
  const agentName = cookieStore.get('agent_name')?.value ?? 'Asesor'

  const conversation = await Conversation.findById(id)
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  conversation.status = 'human'
  conversation.assignedTo = agentName
  conversation.unreadCount = 0
  await conversation.save()

  return NextResponse.json({ success: true, status: 'human', assignedTo: agentName })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  const conversation = await Conversation.findById(id)
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  conversation.status = 'bot'
  conversation.assignedTo = undefined
  await conversation.save()

  return NextResponse.json({ success: true, status: 'bot' })
}
