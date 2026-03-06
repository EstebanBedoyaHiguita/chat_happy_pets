'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { IConversation, IMessage } from '@/types'
import MessageBubble from './MessageBubble'

interface Props {
  conversation: IConversation
  onStatusChange: () => void
}

export default function ChatWindow({ conversation, onStatusChange }: Props) {
  const [messages, setMessages] = useState<IMessage[]>([])
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [takingOver, setTakingOver] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)

  function checkIfAtBottom() {
    const el = scrollContainerRef.current
    if (!el) return
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const fetchMessages = useCallback(async () => {
    const res = await fetch(`/api/conversations/${conversation._id}/messages`)
    if (res.ok) {
      const data = await res.json()
      setMessages(data)
    }
  }, [conversation._id])

  // Initial load + polling every 3s
  useEffect(() => {
    fetchMessages()
    const interval = setInterval(fetchMessages, 3000)
    return () => clearInterval(interval)
  }, [fetchMessages])

  // Always scroll to bottom when switching conversation
  useEffect(() => {
    isAtBottomRef.current = true
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation._id])

  // Only scroll on new messages if user was already at the bottom
  useEffect(() => {
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  async function handleTakeover() {
    setTakingOver(true)
    await fetch(`/api/conversations/${conversation._id}/takeover`, { method: 'POST' })
    onStatusChange()
    setTakingOver(false)
  }

  async function handleReturnToBot() {
    await fetch(`/api/conversations/${conversation._id}/takeover`, { method: 'DELETE' })
    onStatusChange()
  }

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault()
    if (!reply.trim() || sending) return

    setSending(true)
    const text = reply.trim()
    setReply('')

    const res = await fetch(`/api/conversations/${conversation._id}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })

    if (res.ok) {
      await fetchMessages()
    }
    setSending(false)
  }

  const isHuman = conversation.status === 'human'
  const isBot = conversation.status === 'bot'

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-white font-semibold">
            {conversation.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 className="text-white font-medium text-sm">{conversation.name}</h3>
            <p className="text-gray-400 text-xs">{conversation.phone}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status badge */}
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-medium ${
              isHuman
                ? 'bg-green-900/60 text-green-300 border border-green-700'
                : isBot
                ? 'bg-blue-900/60 text-blue-300 border border-blue-700'
                : 'bg-gray-800 text-gray-400 border border-gray-700'
            }`}
          >
            {isHuman
              ? `👤 Humano${conversation.assignedTo ? ` · ${conversation.assignedTo}` : ''}`
              : isBot
              ? '🤖 Bot activo'
              : '✅ Cerrado'}
          </span>

          {/* Takeover / Return to bot buttons */}
          {isBot && (
            <button
              onClick={handleTakeover}
              disabled={takingOver}
              className="bg-green-600 hover:bg-green-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {takingOver ? 'Tomando...' : 'Tomar conversación'}
            </button>
          )}
          {isHuman && (
            <button
              onClick={handleReturnToBot}
              className="bg-blue-700 hover:bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              Devolver al bot
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} onScroll={checkIfAtBottom} className="flex-1 overflow-y-auto px-5 py-4 space-y-1">

        {messages.length === 0 && (
          <div className="text-center text-gray-600 text-sm pt-16">
            No hay mensajes aún
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg._id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Reply input - only when in human mode */}
      {isHuman && (
        <form
          onSubmit={handleSendReply}
          className="px-4 py-3 border-t border-gray-800 bg-gray-900 flex gap-2"
        >
          <input
            type="text"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Escribe una respuesta..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          />
          <button
            type="submit"
            disabled={!reply.trim() || sending}
            className="bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
          >
            {sending ? '...' : 'Enviar'}
          </button>
        </form>
      )}

      {isBot && (
        <div className="px-4 py-2.5 border-t border-gray-800 bg-gray-900 text-center">
          <p className="text-xs text-gray-500">
            El bot está respondiendo automáticamente. Haz clic en &quot;Tomar conversación&quot; para responder manualmente.
          </p>
        </div>
      )}
    </div>
  )
}
