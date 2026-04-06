import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'
import { sendWhatsAppTemplate } from '@/lib/whatsapp'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  const { templateName, languageCode = 'es', components = [] } = await req.json()

  if (!templateName) {
    return NextResponse.json({ error: 'templateName is required' }, { status: 400 })
  }

  const room = await Room.findById(id)
  if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const waMessageId = await sendWhatsAppTemplate(room.waId, templateName, languageCode, components)

  if (!waMessageId) {
    return NextResponse.json({ error: 'Failed to send template' }, { status: 500 })
  }

  // Reopen the conversation window for 24h
  room.status = 'bot'
  room.windowExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await room.save()

  return NextResponse.json({ success: true, waMessageId })
}
