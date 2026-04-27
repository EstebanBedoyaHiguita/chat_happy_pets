const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN
const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID
const API_VERSION = 'v25.0'

export interface MetaTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
  text?: string
  buttons?: { type: string; text: string; url?: string; phone_number?: string }[]
}

export async function createMetaTemplate(params: {
  name: string
  category: string
  language: string
  bodyText: string
}): Promise<{ id: string; status: string }> {
  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${WABA_ID}/message_templates`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: params.name,
        category: params.category,
        language: params.language,
        components: [
          { type: 'BODY', text: params.bodyText },
        ],
      }),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message ?? `Meta API error ${res.status}`)
  return { id: data.id, status: data.status }
}

export async function deleteMetaTemplate(name: string): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${WABA_ID}/message_templates?name=${encodeURIComponent(name)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    }
  )
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error?.message ?? `Meta API error ${res.status}`)
  }
}

export async function syncMetaTemplateStatus(name: string): Promise<string | null> {
  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${WABA_ID}/message_templates?name=${encodeURIComponent(name)}&fields=name,status`,
    {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    }
  )
  if (!res.ok) return null
  const data = await res.json()
  const tpl = (data.data as { name: string; status: string }[])?.find((t) => t.name === name)
  return tpl?.status ?? null
}
