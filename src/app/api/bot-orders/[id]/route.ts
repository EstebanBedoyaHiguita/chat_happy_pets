import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { BotOrder } from '@/lib/models/BotOrder'
import { flagSupplierChange } from '@/lib/supplier-dispatch'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectDB()
  const { id } = await params
  const body = await req.json()
  const update: Record<string, unknown> = {}

  if (body.status !== undefined) {
    const validStatuses = ['pending', 'delivered', 'cancelled']
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: 'Estado inválido' }, { status: 400 })
    }
    update.status = body.status
  }
  if (body.paid !== undefined) {
    update.paid = Boolean(body.paid)
  }

  let order = await BotOrder.findByIdAndUpdate(id, update, { returnDocument: 'after' })
  if (!order) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
  if (update.status === 'cancelled') {
    await flagSupplierChange(order.orderNumber, 'El pedido se canceló')
    order = await BotOrder.findById(id)
  }
  return NextResponse.json(order)
}
