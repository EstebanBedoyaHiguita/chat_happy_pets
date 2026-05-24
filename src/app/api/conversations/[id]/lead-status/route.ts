import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'
import { Customer } from '@/lib/models/Customer'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  const { statusId, statusName, statusColor } = await req.json()

  const update = statusId
    ? { leadStatusId: statusId, leadStatusName: statusName, leadStatusColor: statusColor }
    : { $unset: { leadStatusId: '', leadStatusName: '', leadStatusColor: '' } }

  const room = await Room.findByIdAndUpdate(id, statusId ? { $set: update } : update, { new: true })
  if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Sync to customer
  if (room.waId) {
    if (statusId) {
      await Customer.findOneAndUpdate(
        { waId: room.waId },
        { $set: { leadStatusId: statusId, leadStatusName: statusName, leadStatusColor: statusColor } }
      )
    } else {
      await Customer.findOneAndUpdate(
        { waId: room.waId },
        { $unset: { leadStatusId: '', leadStatusName: '', leadStatusColor: '' } }
      )
    }
  }

  return NextResponse.json({ ok: true })
}
