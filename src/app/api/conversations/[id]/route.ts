import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  const room = await Room.findById(id).lean()
  if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(room)
}
