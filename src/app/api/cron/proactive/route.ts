import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'
import { Message } from '@/lib/models/Message'
import { BotOrder } from '@/lib/models/BotOrder'
import { sendChannelMessage } from '@/lib/whatsapp'

const MESSAGES = [
  // Stage 1 — 1 hour
  (name: string, petName?: string) =>
    `¡Hola ${name}! 🐾 Vi que quedaste con dudas sobre la dieta BARF${petName ? ` para ${petName}` : ''}. ¿Hay algo puntual que pueda explicarte para ayudarte a decidir?`,

  // Stage 2 — 12 hours
  (name: string, petName?: string) =>
    `Hola ${name}, quería contarte que muchos perritos en Medellín ya están comiendo BARF y los cambios más frecuentes son digestión estable, pelaje brillante y más energía 🐕 ¿Le damos esa oportunidad a${petName ? ` ${petName}` : ' tu peludo'}?`,

  // Stage 3 — 23 hours
  (name: string) =>
    `¡Hola ${name}! 😊 Último mensaje del día. Si decides dar el paso, aquí estamos para acompañarte en todo el proceso. Sin complicaciones, con domicilio a tu puerta. 🚪`,
]

const DELAYS_MS = [
  1 * 60 * 60 * 1000,   // 1h
  12 * 60 * 60 * 1000,  // 12h
  23 * 60 * 60 * 1000,  // 23h
]

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await connectDB()

  const now = new Date()

  // Rooms eligible: bot status, within 24h window, proactiveStage < 3
  const rooms = await Room.find({
    status: 'bot',
    windowExpiresAt: { $gt: now },
    proactiveStage: { $lt: 3 },
    lastInboundAt: { $exists: true, $ne: null },
  }).lean()

  if (rooms.length === 0) {
    return NextResponse.json({ sent: 0, checkedAt: now.toISOString() })
  }

  // Get waIds that already have a completed order (don't proactive them)
  const waIds = rooms.map(r => r.waId)
  const orderedWaIds = new Set(
    (await BotOrder.find({ waId: { $in: waIds }, status: { $ne: 'cancelled' } }).distinct('waId'))
  )

  let sent = 0

  for (const room of rooms) {
    if (orderedWaIds.has(room.waId)) continue

    const lastInbound = room.lastInboundAt ? new Date(room.lastInboundAt) : null
    if (!lastInbound) continue

    const elapsed = now.getTime() - lastInbound.getTime()
    const stage = room.proactiveStage ?? 0

    // Find which stage to send (first one whose delay has passed and hasn't been sent yet)
    let stageToSend = -1
    for (let i = stage; i < DELAYS_MS.length; i++) {
      if (elapsed >= DELAYS_MS[i]) {
        stageToSend = i
      }
    }

    if (stageToSend === -1) continue

    const clientName = room.name && room.name !== 'Desconocido' ? room.name : 'amigo'
    const petName = room.petName || undefined
    const text = MESSAGES[stageToSend](clientName, petName)

    try {
      const waMessageId = await sendChannelMessage(room.channel, room.phone, text)

      await Message.create({
        roomId: room._id,
        direction: 'outbound',
        sender: 'bot',
        content: text,
        waMessageId: waMessageId ?? undefined,
        timestamp: new Date(),
      })

      // Atomic update to avoid race conditions
      await Room.updateOne(
        { _id: room._id, proactiveStage: stage },
        { $set: { proactiveStage: stageToSend + 1, lastMessage: text, lastMessageAt: new Date() } }
      )

      sent++
    } catch (err) {
      console.error(`[Proactive] Error sending to ${room.waId}:`, err)
    }
  }

  return NextResponse.json({ sent, checkedAt: now.toISOString() })
}
