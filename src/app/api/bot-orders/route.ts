import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { BotOrder } from '@/lib/models/BotOrder'
import { buildSheetPayload, sendToSheet } from '@/lib/sheet-payload'
import { cookies } from 'next/headers'

export async function GET() {
  await connectDB()
  const orders = await BotOrder.find().sort({ createdAt: -1 }).lean()
  return NextResponse.json(orders)
}

export async function POST(req: NextRequest) {
  try {
  await connectDB()
  const body = await req.json()
  const { customerName, customerPhone, items, address, city, department, notes, shipping = 0 } = body

  if (!customerName || !items?.length || !address || !city) {
    return NextResponse.json({ error: 'Faltan campos obligatorios' }, { status: 400 })
  }

  const orderItems = (items as { name: string; quantity: number; price: number }[]).map((i) => ({
    name: i.name,
    price: Number(i.price) || 0,
    quantity: Number(i.quantity) || 1,
    lineTotal: (Number(i.price) || 0) * (Number(i.quantity) || 1),
    image: '',
  }))

  const subtotal = orderItems.reduce((s, i) => s + i.lineTotal, 0)
  const total = subtotal + Number(shipping)
  const orderNumber = `WA-${Date.now()}`

  const cookieStore = await cookies()
  const agentName = cookieStore.get('agent_name')?.value ?? 'Manual'

  await BotOrder.create({
    orderNumber,
    waId: customerPhone ?? '',
    customerName,
    customerPhone: customerPhone ?? '',
    items: orderItems,
    subtotal,
    shipping,
    total,
    shippingAddress: { address, city, department: department ?? '', notes: notes ?? '' },
    status: 'pending',
  })

  // Mismas columnas que antes: la lógica vive ahora en sheet-payload.ts, compartida con el bot.
  sendToSheet(buildSheetPayload({
    orderNumber,
    customerPhone: customerPhone ?? '',
    customerName,
    items: orderItems,
    address,
    city,
    notes,
  }, { action: 'create', vend: agentName }))

  return NextResponse.json({ success: true, orderNumber }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/bot-orders]', err)
    return NextResponse.json({ error: 'Error al crear el pedido' }, { status: 500 })
  }
}
