'use client'

import { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import ConversationList from '@/components/ConversationList'
import ChatWindow from '@/components/ChatWindow'
import type { IRoom, ConversationStatus } from '@/types'

export default function ChatsPage() {
  const [conversations, setConversations] = useState<IRoom[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<ConversationStatus | 'all'>('all')
  const [search, setSearch] = useState('')

  const selectedConversation = conversations.find((c) => c._id === selectedId) ?? null

  const fetchConversations = useCallback(async () => {
    const qs = new URLSearchParams()
    if (filter !== 'all') qs.set('status', filter)
    if (search) qs.set('search', search)

    const res = await fetch(`/api/conversations?${qs}`)
    if (res.ok) {
      const data = await res.json()
      setConversations(data)
    }
  }, [filter, search])

  // Initial load + polling
  useEffect(() => {
    fetchConversations()
    const interval = setInterval(fetchConversations, 4000)
    return () => clearInterval(interval)
  }, [fetchConversations])

  function handleStatusChange() {
    fetchConversations()
    // Refresh selected conversation
    if (selectedId) {
      fetch(`/api/conversations/${selectedId}`)
        .then((r) => r.json())
        .then((updated) => {
          setConversations((prev) =>
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
