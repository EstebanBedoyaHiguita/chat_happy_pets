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
          className={`rounded-2xl text-sm leading-relaxed ${
            (message.mediaType === 'image' || message.mediaType === 'video') && message.mediaUrl
              ? 'overflow-hidden p-0'
              : 'px-4 py-2.5 whitespace-pre-wrap break-words'
          } ${
            isInbound
              ? 'bg-gray-700 text-white rounded-tl-sm'
              : message.sender === 'bot'
              ? 'bg-gray-400/20 text-gray-100 rounded-tr-sm border border-gray-500/30'
              : 'bg-green-700 text-white rounded-tr-sm'
          }`}
        >
          {message.mediaType === 'image' && message.mediaUrl ? (
            <div>
              <img
                src={message.mediaUrl}
                alt="Imagen"
                className="max-w-full rounded-2xl"
                style={{ maxHeight: 320, display: 'block' }}
              />
              {message.content && message.content !== '[Imagen]' && (
                <p className="px-3 py-2 text-sm">{message.content.replace(/^\[Imagen:\s*/, '').replace(/\]$/, '')}</p>
              )}
            </div>
          ) : message.mediaType === 'video' && message.mediaUrl ? (
            <video
              src={message.mediaUrl}
              controls
              className="max-w-full rounded-2xl"
              style={{ maxHeight: 320, display: 'block' }}
            />
          ) : message.mediaType === 'audio' && message.mediaUrl ? (
            <div className="flex flex-col gap-1 px-3 py-2">
              <audio src={message.mediaUrl} controls style={{ maxWidth: 260 }} />
              {message.content && message.content !== '[Audio]' && (
                <p className="text-xs text-gray-400 mt-1">🎤 {message.content}</p>
              )}
            </div>
          ) : (
            renderContent(message.content)
          )}
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