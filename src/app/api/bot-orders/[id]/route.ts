import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { BotOrder } from '@/lib/models/BotOrder'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await connectDB()
  const { status } = await req.json()
  const validStatuses = ['pending', 'paid', 'delivered', 'cancelled']
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Estado inválido' }, { status: 400 })
  }
  const order = await BotOrder.findByIdAndUpdate(params.id, { status }, { new: true })
  if (!order) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
  return NextResponse.json(order)
}
