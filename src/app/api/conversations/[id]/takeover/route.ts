import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'
import { cookies } from 'next/headers'

export async function POST(
  req: NextRequest,
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

  return NextResponse.json({ success: true, status: 'bot' })
}
