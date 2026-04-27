import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Template } from '@/lib/models/Template'
import { deleteMetaTemplate, syncMetaTemplateStatus } from '@/lib/meta-templates'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectDB()
  const { id } = await params
  const template = await Template.findById(id)
  if (!template) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })

  try {
    await deleteMetaTemplate(template.name)
  } catch {
    // Log but don't block — might already be deleted in Meta
  }

  await Template.findByIdAndDelete(id)
  return NextResponse.json({ success: true })
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Sync status from Meta
  await connectDB()
  const { id } = await params
  const template = await Template.findById(id)
  if (!template) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })

  const status = await syncMetaTemplateStatus(template.name)
  if (status) {
    template.metaStatus = status as typeof template.metaStatus
    await template.save()
  }

  return NextResponse.json(template)
}
