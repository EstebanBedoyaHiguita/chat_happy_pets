import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { LeadStatus } from '@/lib/models/LeadStatus'

export async function GET() {
  await connectDB()
  const statuses = await LeadStatus.find().sort({ order: 1, createdAt: 1 }).lean()
  return NextResponse.json(statuses)
}

export async function POST(req: NextRequest) {
  await connectDB()
  const { name, color } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Nombre requerido' }, { status: 400 })
  const count = await LeadStatus.countDocuments()
  const status = await LeadStatus.create({ name: name.trim(), color: color ?? '#6b7280', order: count })
  return NextResponse.json(status, { status: 201 })
}
