'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const NAV = [
  { href: '/chats', label: 'Chats', icon: '💬', badgeKey: 'unreadChats' },
  { href: '/orders', label: 'Pedidos', icon: '📦', badgeKey: 'pendingOrders' },
  { href: '/settings/knowledge', label: 'Conocimiento', icon: '🧠', badgeKey: null },
  { href: '/settings/rules', label: 'Reglas', icon: '⚡', badgeKey: null },
  { href: '/settings/close-reasons', label: 'Motivos de cierre', icon: '🔴', badgeKey: null },
  { href: '/settings/templates', label: 'Plantillas', icon: '📋', badgeKey: null },
  { href: '/settings/lead-statuses', label: 'Estados de lead', icon: '🏷️', badgeKey: null },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [badges, setBadges] = useState<{ unreadChats: number; pendingOrders: number }>({
    unreadChats: 0,
    pendingOrders: 0,
  })

  async function fetchBadges() {
    try {
      const res = await fetch('/api/badges')
      if (res.ok) setBadges(await res.json())
    } catch { /* silencioso */ }
  }

  useEffect(() => {
    fetchBadges()
    const interval = setInterval(fetchBadges, 30_000)
    return () => clearInterval(interval)
  }, [])

  async function handleLogout() {
    await fetch('/api/auth/login', { method: 'DELETE' })
    router.push('/login')
  }

  return (
    <aside className="w-16 bg-gray-950 border-r border-gray-800 flex flex-col items-center py-4 gap-1">
      <div className="text-2xl mb-4">🐾</div>

      {NAV.map((item) => {
        const count = item.badgeKey ? badges[item.badgeKey as keyof typeof badges] : 0
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={`relative w-10 h-10 flex items-center justify-center rounded-xl text-xl transition-colors ${
              pathname.startsWith(item.href)
                ? 'bg-green-700 text-white'
                : 'text-gray-500 hover:bg-gray-800 hover:text-white'
            }`}
          >
            {item.icon}
            {count > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>
        )
      })}

      <div className="flex-1" />

      <button
        onClick={handleLogout}
        title="Cerrar sesión"
        className="w-10 h-10 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-800 hover:text-white transition-colors text-xl"
      >
        🚪
      </button>
    </aside>
  )
}
