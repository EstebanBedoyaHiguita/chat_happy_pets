import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'
import { Message } from '@/lib/models/Message'
import { cookies } from 'next/headers'
import { soltarTurno, tomarTurno } from '@/lib/turn-lock'
import { correrTurnoDelBot } from '@/lib/bot-turn'

// El turno que crea un pedido encadena varias llamadas a OpenAI y al backend
// (catalogo, ciudades, costo de envio). Con el default de Vercel la funcion se
// quedaba sin tiempo y el cliente no recibia respuesta.
export const maxDuration = 60

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  const cookieStore = await cookies()
  const agentName = cookieStore.get('agent_name')?.value ?? 'Asesor'

  const room = await Room.findById(id)
  if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  room.status = 'human'
  room.assignedTo = agentName
  room.unreadCount = 0
  await room.save()

  return NextResponse.json({ success: true, status: 'human', assignedTo: agentName })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  const room = await Room.findById(id)
  if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  room.status = 'bot'
  room.assignedTo = undefined
  await room.save()

  // Activate bot immediately with the client's last message as context
  waitUntil(resumeBot(id).catch(console.error))

  return NextResponse.json({ success: true, status: 'bot' })
}

async function resumeBot(roomId: string) {
  await connectDB()

  const room = await Room.findById(roomId)
  if (!room || room.status !== 'bot') return

  // Only respond if the last message is from the client — if the last message
  // is from the agent, wait for the client to write first
  const lastMessage = await Message.findOne({ roomId: room._id }).sort({ timestamp: -1 })
  if (!lastMessage || lastMessage.direction === 'outbound') return

  const lastInbound = lastMessage

  // Mismo turno por sala que el webhook (turn-lock.ts): si el cliente justo está
  // escribiendo y el webhook ya está respondiendo, no se le contesta dos veces.
  if (!(await tomarTurno(room._id, 0))) return
  try {
    await Room.updateOne({ _id: room._id }, { $set: { botAnsweredUntil: lastInbound.timestamp } })
    await correrTurnoDelBot(room, { userMessage: lastInbound.content, antesDe: lastInbound.timestamp })
  } finally {
    await soltarTurno(room._id)
  }
}
