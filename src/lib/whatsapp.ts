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
    console.error('Error sending WhatsApp message:', error)
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
    }
  } catch {
    return null
  }
}
