const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN
const API_VERSION = 'v19.0'
const BASE_URL = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`

export async function sendWhatsAppMessage(to: string, text: string): Promise<string | null> {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    console.error('WhatsApp credentials not configured')
    return null
  }

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  }

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const error = await res.json()
    console.error('Error sending WhatsApp message:', error)
    return null
  }

  const data = await res.json()
  return data.messages?.[0]?.id ?? null
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
