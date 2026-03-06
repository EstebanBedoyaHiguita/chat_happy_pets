import type { IMessage } from '@/types'

interface Props {
  message: IMessage
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

const SENDER_LABEL: Record<string, string> = {
  bot: 'Bot',
  human: 'Asesor',
}

const URL_REGEX = new RegExp('(https?://[^\t\n\r ]+)', 'g')

function isImageUrl(url: string) {
  const clean = url.split('?')[0].toLowerCase()
  return (
    clean.endsWith('.jpg') ||
    clean.endsWith('.jpeg') ||
    clean.endsWith('.png') ||
    clean.endsWith('.gif') ||
    clean.endsWith('.webp') ||
    url.includes('res.cloudinary.com')
  )
}

function renderContent(content: string) {
  const parts = content.split(URL_REGEX)
  return parts.map((part, i) => {
    if (part.startsWith('http://') || part.startsWith('https://')) {
      if (isImageUrl(part)) {
        return (
          <img
            key={i}
            src={part}
            alt="producto"
            className="max-w-full rounded-lg mt-2 mb-1"
            style={{ maxHeight: 220 }}
          />
        )
      }
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline opacity-90 break-all">
          {part}
        </a>
      )
    }
    return part ? <span key={i}>{part}</span> : null
  })
}

export default function MessageBubble({ message }: Props) {
  const isInbound = message.direction === 'inbound'

  return (
    <div className={`flex ${isInbound ? 'justify-start' : 'justify-end'} mb-2`}>
      <div className={`max-w-[75%] ${isInbound ? 'items-start' : 'items-end'} flex flex-col`}>
        {!isInbound && message.sender !== 'bot' && (
          <span className="text-xs text-gray-500 mb-0.5 mr-1">
            {SENDER_LABEL[message.sender] ?? message.sender}
          </span>
        )}

        <div
          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
            isInbound
              ? 'bg-gray-700 text-white rounded-tl-sm'
              : message.sender === 'bot'
              ? 'bg-blue-700 text-white rounded-tr-sm'
              : 'bg-green-700 text-white rounded-tr-sm'
          }`}
        >
          {renderContent(message.content)}
        </div>

        <span className="text-xs text-gray-600 mt-0.5 px-1">
          {formatTime(message.timestamp)}
          {!isInbound && (
            <span className="ml-1 text-gray-600">
              {message.sender === 'bot' ? '🤖' : '👤'}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}