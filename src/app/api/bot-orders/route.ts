import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { BotOrder } from '@/lib/models/BotOrder'
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

  // Send to Google Sheets
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK
  if (webhookUrl) {
    const sheetNorm = (s: string) => s.toLowerCase()
    const isBarf = (name: string) => sheetNorm(name).includes('barf') || sheetNorm(name).includes('dieta')
    const barfItems = orderItems.filter(i => isBarf(i.name))
    const snackItems = orderItems.filter(i => !isBarf(i.name))
    const barfQty = (keyword: string, exclude?: string) => {
      const item = barfItems.find(i => {
        const n = sheetNorm(i.name)
        return n.includes(keyword) && (!exclude || !n.includes(exclude))
      })
      return item ? item.quantity : ''
    }

    const sheetPayload = {
      fecha: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
      celular: customerPhone ?? '',
      vend: agentName,
      nombreCliente: customerName,
      pollo:    barfQty('pollo', 'fruta'),
      fruta:    barfQty('fruta'),
      cordero:  barfQty('cordero'),
      res:      barfQty('res'),
      pez:      barfQty('pez') || barfQty('pescado'),
      conejo:   barfQty('conejo'),
      salmon:   barfQty('salmon') || barfQty('salmón'),
      gPollo:   barfQty('gato pollo') || barfQty('g.pll'),
      gTernera: barfQty('gato ternera') || barfQty('g.ter') || barfQty('ternera'),
      snacks:   snackItems.map(i => `${i.quantity}x ${i.name}`).join(' - '),
      observaciones: [address, city, notes].filter(Boolean).join(' | '),
      tipoPago: 'CX',
      orderNumber,
    }

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(sheetPayload),
    }).catch(console.error)
  }

  return NextResponse.json({ success: true, orderNumber }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/bot-orders]', err)
    return NextResponse.json({ error: 'Error al crear el pedido' }, { status: 500 })
  }
}
