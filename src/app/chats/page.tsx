'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '@/components/Sidebar'
import ConversationList from '@/components/ConversationList'
import ChatWindow from '@/components/ChatWindow'
import type { IRoom, ConversationStatus } from '@/types'

function playNotificationSound() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.35)
  } catch { /* AudioContext not available */ }
}

export default function ChatsPage() {
  const [allConversations, setAllConversations] = useState<IRoom[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<ConversationStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const prevUnreadTotalRef = useRef<number | null>(null)

  const selectedConversation = allConversations.find((c) => c._id === selectedId) ?? null

  const counts = {
    all: allConversations.length,
    bot: allConversations.filter((c) => c.status === 'bot').length,
    human: allConversations.filter((c) => c.status === 'human').length,
    closed: allConversations.filter((c) => c.status === 'closed').length,
  }

  const conversations = allConversations.filter((c) => {
    if (filter !== 'all' && c.status !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return c.name.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q)
    }
    return true
  })

  const fetchConversations = useCallback(async () => {
    const res = await fetch('/api/conversations')
    if (res.ok) {
      const data: IRoom[] = await res.json()
      const unreadTotal = data.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0)
      if (prevUnreadTotalRef.current !== null && unreadTotal > prevUnreadTotalRef.current) {
        playNotificationSound()
      }
      prevUnreadTotalRef.current = unreadTotal
      setAllConversations(data)
    }
  }, [])

  // Initial load + polling
  useEffect(() => {
    fetchConversations()
    const interval = setInterval(fetchConversations, 4000)
    return () => clearInterval(interval)
  }, [fetchConversations])

  function handleStatusChange() {
    fetchConversations()
    if (selectedId) {
      fetch(`/api/conversations/${selectedId}`)
        .then((r) => r.json())
        .then((updated: IRoom) => {
          setAllConversations((prev) =>
            prev.map((c) => (c._id === selectedId ? { ...c, ...updated } : c))
          )
        })
    }
  }

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />

      {/* Conversation list */}
      <div className="w-80 flex-shrink-0">
        <ConversationList
          conversations={conversations}
          counts={counts}
          selectedId={selectedId}
          onSelect={setSelectedId}
          filter={filter}
          onFilterChange={setFilter}
          search={search}
          onSearchChange={setSearch}
        />
      </div>

      {/* Chat window */}
      <div className="flex-1">
        {selectedConversation ? (
          <ChatWindow
            conversation={selectedConversation}
            onStatusChange={handleStatusChange}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600">
            <div className="text-center">
              <div className="text-5xl mb-4">💬</div>
              <p className="text-lg">Selecciona una conversación</p>
              <p className="text-sm mt-1">para ver los mensajes</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
