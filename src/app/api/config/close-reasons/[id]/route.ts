import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { CloseReason } from '@/lib/models/CloseReason'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  const { name, active } = await req.json()
  const reason = await CloseReason.findByIdAndUpdate(
    id,
    { ...(name !== undefined ? { name: name.trim() } : {}), ...(active !== undefined ? { active } : {}) },
    { new: true }
  )
  if (!reason) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(reason)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB()
  const { id } = await params
  await CloseReason.findByIdAndDelete(id)
  return NextResponse.json({ success: true })
}
