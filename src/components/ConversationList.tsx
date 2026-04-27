'use client'

import type { IConversation, ConversationStatus } from '@/types'

interface Props {
  conversations: IConversation[]
  selectedId: string | null
  onSelect: (id: string) => void
  filter: ConversationStatus | 'all'
  onFilterChange: (f: ConversationStatus | 'all') => void
  search: string
  onSearchChange: (s: string) => void
}

const STATUS_LABELS: Record<ConversationStatus | 'all', string> = {
  all: 'Todos',
  bot: 'Bot',
  human: 'Humano',
  closed: 'Cerrado',
}

const STATUS_DOT: Record<ConversationStatus, string> = {
  bot: 'bg-blue-400',
  human: 'bg-green-400',
  closed: 'bg-gray-500',
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export default function ConversationList({
  conversations,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
  search,
  onSearchChange,
}: Props) {
  const filters: (ConversationStatus | 'all')[] = ['all', 'bot', 'human', 'closed']

  return (
    <div className="flex flex-col h-full bg-gray-900 border-r border-gray-800">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white font-semibold text-lg flex items-center gap-2">
            <span>🐾</span> Chats
          </h2>
          <span className="text-xs text-gray-500">{conversations.length} conversaciones</span>
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar por nombre o número..."
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500"
        />

        {/* Filter tabs */}
        <div className="flex gap-1 mt-3">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => onFilterChange(f)}
              className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
                filter === f
                  ? 'bg-green-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {STATUS_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <div className="text-center text-gray-500 text-sm p-8">
            No hay conversaciones
          </div>
        )}

        {conversations.map((conv) => (
          <button
            key={conv._id}
            onClick={() => onSelect(conv._id)}
            className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800 transition-colors ${
              selectedId === conv._id ? 'bg-gray-800 border-l-2 border-l-green-500' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-sm font-semibold text-white flex-shrink-0">
                  {conv.name.charAt(0).toUpperCase()}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-white truncate">{conv.name}</span>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[conv.status]}`} />
                    {conv.channel === 'messenger' && <span title="Messenger" className="text-xs">💬</span>}
                    {conv.channel === 'instagram' && <span title="Instagram" className="text-xs">📸</span>}
                  </div>
                  <p className="text-xs text-gray-400 truncate">{conv.lastMessage || '—'}</p>
                </div>
              </div>

              <div className="flex flex-col items-end flex-shrink-0">
                <span className="text-xs text-gray-500">{timeAgo(conv.lastMessageAt)}</span>
                {conv.unreadCount > 0 && (
                  <span className="mt-1 bg-green-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
