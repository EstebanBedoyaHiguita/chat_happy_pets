import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'
import { BotOrder } from '@/lib/models/BotOrder'

export async function GET() {
  await connectDB()
  const [unreadChats, pendingOrders] = await Promise.all([
    Room.countDocuments({ unreadCount: { $gt: 0 } }),
    BotOrder.countDocuments({ status: 'pending' }),
  ])
  return NextResponse.json({ unreadChats, pendingOrders })
}
