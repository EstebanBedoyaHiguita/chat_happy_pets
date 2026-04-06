'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const NAV = [
  { href: '/chats', label: 'Chats', icon: '💬' },
  { href: '/settings/knowledge', label: 'Conocimiento', icon: '🧠' },
  { href: '/settings/rules', label: 'Reglas', icon: '⚡' },
  { href: '/settings/close-reasons', label: 'Motivos de cierre', icon: '🔴' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    await fetch('/api/auth/login', { method: 'DELETE' })
    router.push('/login')
  }

  return (
    <aside className="w-16 bg-gray-950 border-r border-gray-800 flex flex-col items-center py-4 gap-1">
      <div className="text-2xl mb-4">🐾</div>

      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          title={item.label}
          className={`w-10 h-10 flex items-center justify-center rounded-xl text-xl transition-colors ${
            pathname.startsWith(item.href)
              ? 'bg-green-700 text-white'
              : 'text-gray-500 hover:bg-gray-800 hover:text-white'
          }`}
        >
          {item.icon}
        </Link>
      ))}

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
