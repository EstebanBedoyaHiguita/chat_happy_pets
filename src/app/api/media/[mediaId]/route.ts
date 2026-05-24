import { NextRequest, NextResponse } from 'next/server'

const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN
const API_VERSION = 'v25.0'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  const { mediaId } = await params
  if (!ACCESS_TOKEN) return new NextResponse('Unauthorized', { status: 401 })

  // Get media URL from Meta
  const metaRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  })
  if (!metaRes.ok) return new NextResponse('Not found', { status: 404 })

  const { url, mime_type } = await metaRes.json()

  // Fetch the actual media bytes
  const mediaRes = await fetch(url, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  })
  if (!mediaRes.ok) return new NextResponse('Media fetch failed', { status: 502 })

  const buffer = await mediaRes.arrayBuffer()

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': mime_type ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
