import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'
import { Message } from '@/lib/models/Message'
import { sendWhatsAppTemplate } from '@/lib/whatsapp'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  const { templateName, languageCode = 'es', variables = [], bodyText = '' } = await req.json()

  if (!templateName) {
    return NextResponse.json({ error: 'templateName es requerido' }, { status: 400 })
  }

  const room = await Room.findById(id)
  if (!room) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })

  // Build components array from variables array
  const components = variables.length > 0
    ? [{
        type: 'body',
        parameters: variables.map((v: string) => ({ type: 'text', text: v })),
      }]
    : []

  console.log('[reopen] Sending template:', { waId: room.waId, templateName, languageCode, components })
  const waMessageId = await sendWhatsAppTemplate(room.waId, templateName, languageCode, components)
  console.log('[reopen] sendWhatsAppTemplate result:', waMessageId)

  if (!waMessageId) {
    return NextResponse.json({ error: 'Meta rechazó la plantilla. Verifica que esté APROBADA y que el nombre coincida exactamente con el registrado en Meta.' }, { status: 500 })
  }

  // Save outbound message
  const content = bodyText || `[Plantilla: ${templateName}]`
  await Message.create({
    roomId: room._id,
    direction: 'outbound',
    sender: 'bot',
    content,
    waMessageId,
    timestamp: new Date(),
  })

  room.status = 'bot'
  room.windowExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  room.lastMessage = content
  room.lastMessageAt = new Date()
  await room.save()

  return NextResponse.json({ success: true, waMessageId })
}
