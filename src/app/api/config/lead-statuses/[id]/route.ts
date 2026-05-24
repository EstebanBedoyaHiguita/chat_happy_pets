import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { LeadStatus } from '@/lib/models/LeadStatus'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  const { name, color, active } = await req.json()
  const update: Record<string, unknown> = {}
  if (name !== undefined) update.name = name.trim()
  if (color !== undefined) update.color = color
  if (active !== undefined) update.active = active
  const updated = await LeadStatus.findByIdAndUpdate(id, { $set: update }, { new: true })
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  await LeadStatus.findByIdAndDelete(id)
  return NextResponse.json({ ok: true })
}
