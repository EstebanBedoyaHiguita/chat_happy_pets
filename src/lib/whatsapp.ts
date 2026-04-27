const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN
const API_VERSION = 'v25.0'
const BASE_URL = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`

async function sendToWhatsApp(payload: Record<string, unknown>): Promise<string | null> {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    console.error('WhatsApp credentials not configured')
    return null
  }

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const error = await res.json()
    console.error('Error sending WhatsApp message:', JSON.stringify(error))
    return null
  }

  const data = await res.json()
  return data.messages?.[0]?.id ?? null
}

export async function markWhatsAppMessageRead(messageId: string): Promise<void> {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) return
  fetch(BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }),
  }).catch(() => {})
}

export async function sendWhatsAppMessage(to: string, text: string): Promise<string | null> {
  return sendToWhatsApp({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  })
}

export async function sendWhatsAppImage(to: string, imageUrl: string, caption?: string): Promise<string | null> {
  return sendToWhatsApp({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'image',
    image: { link: imageUrl, ...(caption ? { caption } : {}) },
  })
}

export function extractImageUrls(text: string): { cleanText: string; imageUrls: string[] } {
  const imageUrls: string[] = []

  // Remove markdown image syntax ![alt](url) and capture the URL
  let cleaned = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (_match, _alt, url) => {
    imageUrls.push(url)
    return ''
  })

  // Also remove bare URL-only lines and capture the URL
  cleaned = cleaned.split('\n').filter((line) => {
    const trimmed = line.trim()
    const match = trimmed.match(/^(?:-?\s*(?:Imagen|imagen|img):\s*)?(https?:\/\/\S+)$/)
    if (match && match[1]) {
      imageUrls.push(match[1])
      return false
    }
    return true
  }).join('\n')

  return { cleanText: cleaned.trim(), imageUrls }
}

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  components: Record<string, unknown>[] = []
): Promise<string | null> {
  return sendToWhatsApp({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  })
}

export interface IncomingWhatsAppMessage {
  from: string
  name: string
  text: string
  messageId: string
  timestamp: string
  channel: 'whatsapp' | 'messenger' | 'instagram'
}

export function parseWebhookPayload(body: Record<string, unknown>): IncomingWhatsAppMessage | null {
  try {
    const entry = (body.entry as Record<string, unknown>[])?.[0]
    const changes = (entry?.changes as Record<string, unknown>[])?.[0]
    const value = changes?.value as Record<string, unknown>

    const message = (value?.messages as Record<string, unknown>[])?.[0]
    if (!message || message.type !== 'text') return null

    const contact = (value?.contacts as Record<string, unknown>[])?.[0]
    const profile = contact?.profile as Record<string, unknown>

    return {
      from: message.from as string,
      name: (profile?.name as string) ?? 'Desconocido',
      text: (message.text as Record<string, unknown>)?.body as string,
      messageId: message.id as string,
      timestamp: message.timestamp as string,
      channel: 'whatsapp',
    }
  } catch {
    return null
  }
}

// ── Messenger & Instagram ──────────────────────────────────────────────────

const META_PAGE_TOKEN = process.env.META_PAGE_ACCESS_TOKEN
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN
const INSTAGRAM_BUSINESS_ID = process.env.INSTAGRAM_BUSINESS_ID

function getMetaConfig(channel: 'messenger' | 'instagram') {
  if (channel === 'instagram') {
    return {
      token: INSTAGRAM_TOKEN,
      url: `https://graph.facebook.com/v25.0/${INSTAGRAM_BUSINESS_ID}/messages`,
    }
  }
  return {
    token: META_PAGE_TOKEN,
    url: `https://graph.facebook.com/v25.0/me/messages`,
  }
}

async function sendMetaMessage(channel: 'messenger' | 'instagram', recipientId: string, text: string): Promise<string | null> {
  const { token, url } = getMetaConfig(channel)
  if (!token) { console.error(`Token not set for channel ${channel}`); return null }
  const res = await fetch(`${url}?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  })
  const data = await res.json()
  if (!res.ok) { console.error(`Meta send error (${channel}):`, data); return null }
  return data.message_id ?? null
}

async function sendMetaImage(channel: 'messenger' | 'instagram', recipientId: string, imageUrl: string, caption?: string): Promise<string | null> {
  const { token, url } = getMetaConfig(channel)
  if (!token) return null
  const res = await fetch(`${url}?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } } },
    }),
  })
  const data = await res.json()
  if (!res.ok) { console.error(`Meta image send error (${channel}):`, data); return null }
  if (caption) await sendMetaMessage(channel, recipientId, caption)
  return data.message_id ?? null
}

export async function sendChannelMessage(
  channel: 'whatsapp' | 'messenger' | 'instagram',
  recipientId: string,
  text: string
): Promise<string | null> {
  if (channel === 'whatsapp') return sendWhatsAppMessage(recipientId, text)
  return sendMetaMessage(channel, recipientId, text)
}

export async function sendChannelImage(
  channel: 'whatsapp' | 'messenger' | 'instagram',
  recipientId: string,
  imageUrl: string,
  caption?: string
): Promise<string | null> {
  if (channel === 'whatsapp') return sendWhatsAppImage(recipientId, imageUrl, caption)
  return sendMetaImage(channel, recipientId, imageUrl, caption)
}

export function parseMessengerPayload(body: Record<string, unknown>): IncomingWhatsAppMessage | null {
  try {
    const object = body.object as string
    if (object !== 'page' && object !== 'instagram') return null
    const channel: 'messenger' | 'instagram' = object === 'instagram' ? 'instagram' : 'messenger'

    const entry = (body.entry as Record<string, unknown>[])?.[0]
    const messaging = (entry?.messaging as Record<string, unknown>[])?.[0]
    if (!messaging) return null

    const message = messaging.message as Record<string, unknown>
    if (!message || message.is_echo) return null
    if (!message.text) return null // ignore non-text for now

    const sender = messaging.sender as Record<string, unknown>

    return {
      from: sender.id as string,
      name: 'Desconocido',
      text: message.text as string,
      messageId: message.mid as string,
      timestamp: String(messaging.timestamp ?? Date.now()),
      channel,
    }
  } catch {
    return null
  }
}
