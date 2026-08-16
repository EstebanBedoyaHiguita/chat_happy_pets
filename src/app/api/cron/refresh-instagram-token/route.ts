import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { AppSetting, INSTAGRAM_TOKEN_KEY } from '@/lib/models/AppSetting'
import { getInstagramToken } from '@/lib/whatsapp'

// Los tokens de "Instagram API con login de Instagram" duran 60 días. Este cron los
// renueva antes de que venzan: sin esto, un día los DMs de Instagram dejan de
// responderse en silencio. Meta exige que el token tenga al menos 24h de vida.
const RENEW_WHEN_DAYS_LEFT = 15
const DAY_MS = 24 * 60 * 60 * 1000

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await connectDB()

  const token = await getInstagramToken()
  if (!token) {
    return NextResponse.json({ status: 'skipped', reason: 'no_token' })
  }
  // El refresh solo existe para los tokens de Instagram Login (IGAA...).
  // Un token de login con Facebook (EAA...) se renueva por otra vía.
  if (!token.startsWith('IGAA')) {
    return NextResponse.json({ status: 'skipped', reason: 'not_instagram_login_token' })
  }

  const stored = await AppSetting.findOne({ key: INSTAGRAM_TOKEN_KEY })
  const expiresAt = stored?.expiresAt as Date | undefined
  const daysLeft = expiresAt ? (expiresAt.getTime() - Date.now()) / DAY_MS : null

  // Renovar todos los días sería inútil y arriesga el límite de 24h de Meta:
  // solo se pide un token nuevo cuando de verdad se acerca el vencimiento.
  if (daysLeft !== null && daysLeft > RENEW_WHEN_DAYS_LEFT) {
    return NextResponse.json({
      status: 'skipped',
      reason: 'still_valid',
      daysLeft: Math.round(daysLeft),
      expiresAt: expiresAt?.toISOString(),
    })
  }

  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`
  const res = await fetch(url)
  const data = await res.json()

  if (!res.ok || !data.access_token) {
    console.error('[Instagram] Error renovando el token:', JSON.stringify(data))
    return NextResponse.json(
      { status: 'error', error: data?.error?.message ?? 'refresh_failed' },
      { status: 502 }
    )
  }

  const newExpiresAt = new Date(Date.now() + (Number(data.expires_in) || 60 * 24 * 60 * 60) * 1000)
  await AppSetting.findOneAndUpdate(
    { key: INSTAGRAM_TOKEN_KEY },
    { $set: { value: data.access_token, expiresAt: newExpiresAt } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )

  console.log('[Instagram] Token renovado, vence el', newExpiresAt.toISOString())
  return NextResponse.json({
    status: 'refreshed',
    expiresAt: newExpiresAt.toISOString(),
  })
}
