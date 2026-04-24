import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { BotOrder } from '@/lib/models/BotOrder'

export async function GET() {
  await connectDB()
  const orders = await BotOrder.find().sort({ createdAt: -1 }).lean()
  return NextResponse.json(orders)
}
