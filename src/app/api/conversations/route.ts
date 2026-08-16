import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'

export async function GET(req: NextRequest) {
  await connectDB()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const search = searchParams.get('search')

  const query: Record<string, unknown> = {}
  if (status && status !== 'all') query.status = status
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { username: { $regex: search, $options: 'i' } },
    ]
  }

  const rooms = await Room.find(query).sort({ lastMessageAt: -1 }).limit(100).lean()
  return NextResponse.json(rooms)
}
