import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'
import { CloseReason } from '@/lib/models/CloseReason'
import { cookies } from 'next/headers'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  const { closeReasonId } = await req.json()

  if (!closeReasonId) {
    return NextResponse.json({ error: 'closeReasonId is required' }, { status: 400 })
  }

  const reason = await CloseReason.findById(closeReasonId)
  if (!reason) {
    return NextResponse.json({ error: 'Close reason not found' }, { status: 404 })
  }

  const room = await Room.findById(id)
  if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const cookieStore = await cookies()
  const agentName = cookieStore.get('agent_name')?.value ?? 'Asesor'

  room.status = 'closed'
  room.closeReasonId = closeReasonId
  room.closeReasonName = reason.name
  room.closedBy = agentName
  await room.save()

  return NextResponse.json({ success: true })
}
