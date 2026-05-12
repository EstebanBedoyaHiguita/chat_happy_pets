'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { IRoom, IMessage, ICloseReason } from '@/types'
import MessageBubble from './MessageBubble'

interface Props {
  conversation: IRoom
  onStatusChange: () => void
}

export default function ChatWindow({ conversation, onStatusChange }: Props) {
  const [messages, setMessages] = useState<IMessage[]>([])
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [takingOver, setTakingOver] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [showContactCard, setShowContactCard] = useState(false)
  const [expandedPets, setExpandedPets] = useState<Record<number, boolean>>({ 1: true, 2: false, 3: false })
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [closeReasons, setCloseReasons] = useState<ICloseReason[]>([])
  const [selectedReasonId, setSelectedReasonId] = useState('')
  const [closing, setClosing] = useState(false)
  const [showReopenModal, setShowReopenModal] = useState(false)
  const [templates, setTemplates] = useState<{ _id: string; name: string; displayName: string; bodyText: string; variables: string[]; metaStatus: string; language: string }[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [templateVars, setTemplateVars] = useState<string[]>([])
  const [reopenError, setReopenError] = useState<string>('')
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

  async function handleSendReply(e: React.FormEvent<HTMLFormElement>) {
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
  const isClosed = conversation.status === 'closed'

  const windowExpired =
    conversation.windowExpiresAt != null &&
    new Date(conversation.windowExpiresAt) < new Date()

  const windowMinutesLeft =
    conversation.windowExpiresAt && !windowExpired
      ? Math.max(0, Math.round((new Date(conversation.windowExpiresAt).getTime() - Date.now()) / 60000))
      : null

  async function handleOpenCloseModal() {
    const res = await fetch('/api/config/close-reasons')
    if (res.ok) {
      const data = await res.json()
      setCloseReasons(data.filter((r: ICloseReason) => r.active))
    }
    setSelectedReasonId('')
    setShowCloseModal(true)
  }

  async function handleClose(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selectedReasonId || closing) return
    setClosing(true)
    const res = await fetch(`/api/conversations/${conversation._id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ closeReasonId: selectedReasonId }),
    })
    setClosing(false)
    if (res.ok) {
      setShowCloseModal(false)
      onStatusChange()
    }
  }

  async function handleOpenReopenModal() {
    const res = await fetch('/api/templates')
    if (res.ok) setTemplates(await res.json())
    setSelectedTemplate('')
    setTemplateVars([])
    setReopenError('')
    setShowReopenModal(true)
  }

  function handleSelectTemplate(id: string) {
    setSelectedTemplate(id)
    const tpl = templates.find((t) => t._id === id)
    if (!tpl) { setTemplateVars([]); return }
    // Detect variable count from bodyText ({{1}}, {{2}}, etc.) as fallback when variables array is empty
    const matches = tpl.bodyText.match(/\{\{(\d+)\}\}/g) ?? []
    const maxVar = matches.reduce((max, m) => Math.max(max, parseInt(m.replace(/\{\{|\}\}/g, ''))), 0)
    const count = Math.max(maxVar, tpl.variables.length)
    setTemplateVars(Array(count).fill(''))
  }

  async function handleReopen(e: React.FormEvent) {
    e.preventDefault()
    if (reopening) return
    const tpl = templates.find((t) => t._id === selectedTemplate)
    if (!tpl) return
    setReopening(true)
    setReopenError('')
    const bodyText = tpl.bodyText.replace(/\{\{(\d+)\}\}/g, (_, n) => templateVars[Number(n) - 1] ?? `{{${n}}}`)
    try {
      const res = await fetch(`/api/conversations/${conversation._id}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateName: tpl.name,
          languageCode: tpl.language,
          variables: templateVars,
          bodyText,
        }),
      })
      if (res.ok) {
        setShowReopenModal(false)
        onStatusChange()
      } else {
        const data = await res.json().catch(() => ({}))
        setReopenError(data.error ?? `Error ${res.status} al enviar la plantilla`)
      }
    } catch {
      setReopenError('Error de red al enviar la plantilla')
    } finally {
      setReopening(false)
    }
  }

  return (
    <div className="flex h-full bg-gray-950">

      {/* ── Main chat column ── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 bg-gray-900">
          <button
            onClick={() => setShowContactCard((v) => !v)}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity text-left"
          >
            <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-white font-semibold">
              {conversation.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-white font-medium text-sm underline decoration-dotted flex items-center gap-1.5">
                {conversation.name}
                {conversation.channel === 'messenger' && <span title="Messenger">💬</span>}
                {conversation.channel === 'instagram' && <span title="Instagram">📸</span>}
              </h3>
              <p className="text-gray-400 text-xs">{conversation.phone}</p>
            </div>
          </button>

          <div className="flex items-center gap-2">
            {(isBot || isHuman) && windowExpired && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-900/60 text-red-300 border border-red-700">
                ⏰ Ventana cerrada
              </span>
            )}
            {(isBot || isHuman) && !windowExpired && windowMinutesLeft !== null && windowMinutesLeft < 60 && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-yellow-900/60 text-yellow-300 border border-yellow-700">
                ⏳ {windowMinutesLeft}m restantes
              </span>
            )}
            {(isBot || isHuman) && !windowExpired && windowMinutesLeft !== null && windowMinutesLeft >= 60 && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-900/40 text-green-400 border border-green-800">
                ✅ Ventana {Math.floor(windowMinutesLeft / 60)}h abierta
              </span>
            )}
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
              isHuman ? 'bg-green-900/60 text-green-300 border border-green-700'
              : isBot ? 'bg-blue-900/60 text-blue-300 border border-blue-700'
              : 'bg-gray-800 text-gray-400 border border-gray-700'
            }`}>
              {isHuman ? `👤 Humano${conversation.assignedTo ? ` · ${conversation.assignedTo}` : ''}` : isBot ? '🤖 Bot activo' : '✅ Cerrado'}
            </span>
            {isBot && (
              <button onClick={handleTakeover} disabled={takingOver}
                className="bg-green-600 hover:bg-green-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                {takingOver ? 'Tomando...' : 'Tomar conversación'}
              </button>
            )}
            {isHuman && (
              <button onClick={handleReturnToBot}
                className="bg-blue-700 hover:bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                Devolver al bot
              </button>
            )}
            {(isBot || isHuman) && (
              <button onClick={handleOpenCloseModal}
                className="bg-red-700 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                🔴 Cerrar conversación
              </button>
            )}
            {isClosed && (
              <button onClick={handleOpenReopenModal}
                className="bg-purple-700 hover:bg-purple-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                📨 Retomar conversación
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollContainerRef} onScroll={checkIfAtBottom} className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
          {messages.length === 0 && (
            <div className="text-center text-gray-600 text-sm pt-16">No hay mensajes aún</div>
          )}
          {messages.map((msg) => <MessageBubble key={msg._id} message={msg} />)}
          <div ref={bottomRef} />
        </div>

        {/* Reply input */}
        {isHuman && (
          <form onSubmit={handleSendReply} className="px-4 py-3 border-t border-gray-800 bg-gray-900 flex gap-2">
            <input type="text" value={reply} onChange={(e) => setReply(e.target.value)}
              placeholder="Escribe una respuesta..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <button type="submit" disabled={!reply.trim() || sending}
              className="bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors">
              {sending ? '...' : 'Enviar'}
            </button>
          </form>
        )}
        {isBot && (
          <div className="px-4 py-2.5 border-t border-gray-800 bg-gray-900 text-center">
            <p className="text-xs text-gray-500">El bot está respondiendo automáticamente. Haz clic en &quot;Tomar conversación&quot; para responder manualmente.</p>
          </div>
        )}
        {isClosed && (
          <div className="px-4 py-2.5 border-t border-gray-800 bg-gray-900 text-center">
            <p className="text-xs text-gray-500">Conversación cerrada. Usa &quot;Retomar conversación&quot; para enviar una plantilla aprobada.</p>
          </div>
        )}
      </div>

      {/* ── Contact card panel ── */}
      {showContactCard && (
        <div className="w-72 flex-shrink-0 border-l border-gray-800 bg-gray-900 flex flex-col overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <h3 className="text-white font-semibold text-sm">Datos del contacto</h3>
            <button onClick={() => setShowContactCard(false)} className="text-gray-500 hover:text-white text-lg transition-colors">×</button>
          </div>

          {/* Avatar + name */}
          <div className="flex flex-col items-center gap-2 py-5 border-b border-gray-800">
            <div className="w-14 h-14 rounded-full bg-gray-700 flex items-center justify-center text-white text-2xl font-bold">
              {conversation.name.charAt(0).toUpperCase()}
            </div>
            <p className="text-white font-medium text-sm">{conversation.name}</p>
            <p className="text-gray-500 text-xs">{conversation.phone}</p>
          </div>

          <div className="flex flex-col gap-0 px-4 py-4">
            {/* Basic info */}
            {[
              { label: 'Dirección', value: conversation.address },
              { label: 'Estado', value: conversation.status },
              ...(conversation.assignedTo ? [{ label: 'Asignado a', value: conversation.assignedTo }] : []),
              ...(conversation.closeReasonName ? [{ label: 'Motivo de cierre', value: conversation.closeReasonName }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="mb-3">
                <p className="text-gray-500 text-xs mb-0.5">{label}</p>
                <p className="text-white text-sm">{value || '—'}</p>
              </div>
            ))}

            {/* Pet sections */}
            {[
              { n: 1, type: conversation.petType, name: conversation.petName, age: conversation.petAge, weight: conversation.petWeight },
              { n: 2, type: conversation.pet2Type, name: conversation.pet2Name, age: conversation.pet2Age, weight: conversation.pet2Weight },
              { n: 3, type: conversation.pet3Type, name: conversation.pet3Name, age: conversation.pet3Age, weight: conversation.pet3Weight },
            ].map(({ n, type, name, age, weight }) => {
              const hasData = type || name || age || weight
              const isOpen = expandedPets[n]
              return (
                <div key={n} className="mt-2 rounded-xl border border-gray-700 overflow-hidden">
                  <button
                    onClick={() => setExpandedPets(p => ({ ...p, [n]: !p[n] }))}
                    className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 hover:bg-gray-750 transition-colors"
                  >
                    <span className="text-xs font-medium text-gray-300 flex items-center gap-2">
                      🐾 Mascota {n}
                      {hasData && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />}
                    </span>
                    <span className="text-gray-500 text-xs">{isOpen ? '▲' : '▼'}</span>
                  </button>
                  {isOpen && (
                    <div className="px-3 py-2.5 flex flex-col gap-2 bg-gray-900">
                      {[
                        { label: 'Nombre', value: name },
                        { label: 'Tipo', value: type },
                        { label: 'Edad', value: age },
                        { label: 'Peso', value: weight },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between items-center">
                          <span className="text-gray-500 text-xs">{label}</span>
                          <span className="text-white text-xs">{value || '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Reopen modal ── */}
      {showReopenModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md mx-4">
            <h2 className="text-white font-semibold text-base mb-1">Retomar conversación</h2>
            <p className="text-gray-400 text-xs mb-4">Elige una plantilla aprobada para enviar al cliente y reabrir la ventana de 24h.</p>

            {templates.filter((t) => t.metaStatus === 'APPROVED').length === 0 ? (
              <div className="text-center py-6">
                <p className="text-yellow-400 text-sm">No hay plantillas aprobadas por Meta aún.</p>
                <p className="text-gray-500 text-xs mt-1">Ve a Configuración → Plantillas para crear y enviar a revisión.</p>
              </div>
            ) : (
              <form onSubmit={handleReopen} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  {templates.filter((t) => t.metaStatus === 'APPROVED').map((t) => (
                    <label key={t._id} className={`flex flex-col gap-1 cursor-pointer p-3 rounded-xl border transition-colors ${selectedTemplate === t._id ? 'border-purple-500 bg-purple-500/10' : 'border-gray-700 hover:bg-gray-800'}`}>
                      <div className="flex items-center gap-2">
                        <input type="radio" name="template" value={t._id}
                          checked={selectedTemplate === t._id}
                          onChange={() => handleSelectTemplate(t._id)}
                          className="accent-purple-500"
                        />
                        <span className="text-white text-sm font-medium">{t.displayName}</span>
                      </div>
                      <p className="text-gray-500 text-xs pl-5 whitespace-pre-wrap">{t.bodyText}</p>
                    </label>
                  ))}
                </div>

                {selectedTemplate && templateVars.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-gray-400 text-xs font-medium">Completa las variables:</p>
                    {templateVars.map((v, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-gray-500 text-xs w-16 flex-shrink-0">{`{{${i + 1}}}`}</span>
                        <input
                          value={v}
                          onChange={(e) => {
                            const updated = [...templateVars]
                            updated[i] = e.target.value
                            setTemplateVars(updated)
                          }}
                          placeholder={templates.find((t) => t._id === selectedTemplate)?.variables[i] ?? `Variable ${i + 1}`}
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {reopenError && (
                  <p className="text-red-400 text-xs bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">{reopenError}</p>
                )}

                <div className="flex gap-2 justify-end mt-1">
                  <button type="button" onClick={() => setShowReopenModal(false)}
                    className="text-gray-400 hover:text-white text-sm px-4 py-2 rounded-lg transition-colors">
                    Cancelar
                  </button>
                  <button type="submit" disabled={!selectedTemplate || reopening}
                    className="bg-purple-700 hover:bg-purple-600 disabled:bg-gray-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                    {reopening ? 'Enviando...' : '📨 Enviar plantilla'}
                  </button>
                </div>
              </form>
            )}

            {templates.filter((t) => t.metaStatus === 'APPROVED').length === 0 && (
              <button onClick={() => setShowReopenModal(false)}
                className="mt-3 w-full text-gray-400 hover:text-white text-sm py-2 rounded-lg transition-colors">
                Cerrar
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Close modal (fixed overlay) ── */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md mx-4">
            <h2 className="text-white font-semibold text-base mb-1">Cerrar conversación</h2>
            <p className="text-gray-400 text-xs mb-4">Selecciona el motivo de cierre.</p>
            <form onSubmit={handleClose} className="flex flex-col gap-3">
              {closeReasons.length === 0 ? (
                <p className="text-yellow-400 text-xs">No hay motivos configurados. Ve a Configuración → Motivos de cierre.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {closeReasons.map((r) => (
                    <label key={r._id} className="flex items-center gap-3 cursor-pointer p-2.5 rounded-xl hover:bg-gray-800 transition-colors">
                      <input type="radio" name="reason" value={r._id}
                        checked={selectedReasonId === r._id}
                        onChange={() => setSelectedReasonId(r._id)}
                        className="accent-red-500"
                      />
                      <span className="text-white text-sm">{r.name}</span>
                    </label>
                  ))}
                </div>
              )}
              <div className="flex gap-2 justify-end mt-1">
                <button type="button" onClick={() => setShowCloseModal(false)}
                  className="text-gray-400 hover:text-white text-sm px-4 py-2 rounded-lg transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={!selectedReasonId || closing || closeReasons.length === 0}
                  className="bg-red-700 hover:bg-red-600 disabled:bg-gray-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                  {closing ? 'Cerrando...' : 'Confirmar cierre'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
