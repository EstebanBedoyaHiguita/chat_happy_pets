import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Template } from '@/lib/models/Template'
import { createMetaTemplate } from '@/lib/meta-templates'

export async function GET() {
  await connectDB()
  const templates = await Template.find().sort({ createdAt: -1 })
  return NextResponse.json(templates)
}

export async function POST(req: NextRequest) {
  await connectDB()
  const body = await req.json()
  const { displayName, category, language, bodyText, variables } = body

  if (!displayName || !bodyText) {
    return NextResponse.json({ error: 'displayName y bodyText son requeridos' }, { status: 400 })
  }

  // Generate slug name for Meta (lowercase, underscores, no special chars)
  const name = displayName
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 60)

  // Create in Meta
  let metaId = ''
  let metaStatus = 'PENDING'
  try {
    const meta = await createMetaTemplate({ name, category: category ?? 'UTILITY', language: language ?? 'es', bodyText })
    metaId = meta.id
    metaStatus = meta.status ?? 'PENDING'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Error en Meta API: ${msg}` }, { status: 422 })
  }

  const template = await Template.create({
    name,
    displayName,
    category: category ?? 'UTILITY',
    language: language ?? 'es',
    bodyText,
    variables: variables ?? [],
    metaId,
    metaStatus,
  })

  return NextResponse.json(template, { status: 201 })
}
