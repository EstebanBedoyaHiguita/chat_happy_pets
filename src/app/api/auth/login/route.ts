import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  const apiUrl = process.env.HAPPY_PETS_API_URL
  let data
  try {
    const res = await fetch(`${apiUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    const body = await res.json()

    if (!res.ok) {
      // Forward the actual error message from the backend
      const msg = body?.message ?? body?.error ?? 'Invalid credentials'
      const msgStr = Array.isArray(msg) ? msg.join(', ') : String(msg)
      return NextResponse.json({ error: msgStr }, { status: 401 })
    }

    data = body
  } catch {
    return NextResponse.json({ error: 'Could not connect to auth service' }, { status: 503 })
  }

  const user = data.user
  if (!user || (user.role !== 'admin' && user.role !== 'agent')) {
    return NextResponse.json({
      error: `Acceso denegado. Tu rol es "${user?.role ?? 'desconocido'}". Se requiere rol admin o agent.`
    }, { status: 403 })
  }

  const response = NextResponse.json({
    user: { name: user.name, email: user.email, role: user.role },
  })

  response.cookies.set('auth_token', data.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  response.cookies.set('agent_name', user.name, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  return response
}

export async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.delete('auth_token')
  response.cookies.delete('agent_name')
  return response
}
