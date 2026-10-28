import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'
import { Message } from '@/lib/models/Message'
import { BotOrder } from '@/lib/models/BotOrder'
import { sendChannelMessage, channelRecipientId } from '@/lib/whatsapp'
import { debeHacerSeguimiento, dentroDeHorario, etapaQueToca, mensajeProactivo } from '@/lib/proactive'

// Las reglas (horario, etapas, textos, cuándo NO escribir) viven en lib/proactive.ts.

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  // Fuera de horario no se le escribe a nadie: lo pendiente sale en la siguiente
  // ejecución dentro del horario, si la ventana de 24 h sigue abierta.
  if (!dentroDeHorario(now)) {
    return NextResponse.json({ sent: 0, skipped: 'fuera de horario', checkedAt: now.toISOString() })
  }

  await connectDB()

  // Rooms eligible: bot status, within 24h window, proactiveStage < 3
  const rooms = await Room.find({
    status: 'bot',
    windowExpiresAt: { $gt: now },
    proactiveStage: { $lt: 3 },
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
    // El bot está respondiendo en este momento: no se le cruza un seguimiento.
    if (room.botLockUntil && new Date(room.botLockUntil) > now) continue

    // Use lastInboundAt if available, fall back to lastMessageAt for older rooms
    const lastInbound = room.lastInboundAt
      ? new Date(room.lastInboundAt)
      : room.lastMessageAt
        ? new Date(room.lastMessageAt)
        : null
    if (!lastInbound) continue

    const stage = room.proactiveStage ?? 0
    const stageToSend = etapaQueToca(now.getTime() - lastInbound.getTime(), stage)
    if (stageToSend === -1) continue

    const ultimo = await Message.findOne({ roomId: room._id }).sort({ timestamp: -1 }).select('direction').lean<{ direction: string }>()
    if (!debeHacerSeguimiento(ultimo)) {
      console.warn(`[Proactive] ${room.waId}: lo último es del cliente y nadie le respondió; no se envía seguimiento`)
      continue
    }

    // La etapa se reclama ANTES de enviar: dos ejecuciones simultáneas del cron enviaban
    // el mismo mensaje dos veces, porque cada una marcaba la etapa después de mandarlo.
    const claim = await Room.updateOne(
      { _id: room._id, proactiveStage: stage },
      { $set: { proactiveStage: stageToSend + 1 } }
    )
    if (claim.modifiedCount !== 1) continue

    const text = mensajeProactivo(stageToSend, {
      name: room.name,
      petName: room.petName || undefined,
      petTypes: [room.petType, room.pet2Type, room.pet3Type],
    })

    try {
      const recipientId = channelRecipientId(room)
      const waMessageId = await sendChannelMessage(room.channel, recipientId, text)

      await Message.create({
        roomId: room._id,
        direction: 'outbound',
        sender: 'bot',
        content: text,
        waMessageId: waMessageId ?? undefined,
        timestamp: new Date(),
      })
      await Room.updateOne({ _id: room._id }, { $set: { lastMessage: text, lastMessageAt: new Date() } })

      sent++
    } catch (err) {
      console.error(`[Proactive] Error sending to ${room.waId}:`, err)
    }
  }

  return NextResponse.json({ sent, checkedAt: now.toISOString() })
}
