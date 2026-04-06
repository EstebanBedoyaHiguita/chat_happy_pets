import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { Room } from '@/lib/models/Room'

// Called by Vercel Cron every hour
// vercel.json: { "crons": [{ "path": "/api/cron/close-windows", "schedule": "0 * * * *" }] }
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await connectDB()

  const now = new Date()

  // Close bot/human conversations whose 24h window has expired
  const result = await Room.updateMany(
    {
      status: { $in: ['bot', 'human'] },
      windowExpiresAt: { $lt: now, $ne: null },
    },
    { $set: { status: 'closed' } }
  )

  return NextResponse.json({
    closed: result.modifiedCount,
    checkedAt: now.toISOString(),
  })
}
