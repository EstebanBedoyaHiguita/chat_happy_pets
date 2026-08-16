const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN
const API_VERSION = 'v25.0'
const BASE_URL = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`

// Business-Scoped User ID (BSUID): identificador que Meta envía cuando el usuario
// configuró un username y su teléfono ya no viene en el webhook. Formato: "CO.1A2B3C4D..."
// Los usuarios sin username siguen llegando con teléfono y se manejan igual que siempre.
const BSUID_REGEX = /^[A-Za-z]{2}\.[A-Za-z0-9]+$/

export function isBsuid(id: string): boolean {
  return BSUID_REGEX.test(id)
}

// Un teléfono va en `to` (comportamiento de siempre); un BSUID va en `recipient`,
// porque `to` solo acepta números telefónicos.
function recipientFields(id: string): Record<string, string> {
  return isBsuid(id)
    ? { recipient: id }
    : { recipient_type: 'individual', to: id }
}

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
    ...recipientFields(to),
    type: 'text',
    text: { body: text },
  })
}

export async function sendWhatsAppImage(to: string, imageUrl: string, caption?: string): Promise<string | null> {
  return sendToWhatsApp({
    messaging_product: 'whatsapp',
    ...recipientFields(to),
    type: 'image',
    image: { link: imageUrl, ...(caption ? { caption } : {}) },
  })
}

export async function getWhatsAppMediaAsBase64(mediaId: string): Promise<string | null> {
  if (!ACCESS_TOKEN) return null
  const metaRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  })
  if (!metaRes.ok) return null
  const metaData = await metaRes.json()
  const downloadUrl = metaData.url as string
  const mimeType = (metaData.mime_type as string) ?? 'image/jpeg'
  const mediaRes = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  })
  if (!mediaRes.ok) return null
  const buffer = await mediaRes.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')
  return `data:${mimeType};base64,${base64}`
}

export async function getWhatsAppAudioBuffer(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!ACCESS_TOKEN) return null
  const metaRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  })
  if (!metaRes.ok) return null
  const metaData = await metaRes.json()
  const downloadUrl = metaData.url as string
  const mimeType = (metaData.mime_type as string) ?? 'audio/ogg'
  const mediaRes = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  })
  if (!mediaRes.ok) return null
  const buffer = Buffer.from(await mediaRes.arrayBuffer())
  return { buffer, mimeType }
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
): Promise<{ messageId: string | null; error: string | null }> {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    return { messageId: null, error: 'WhatsApp credentials not configured' }
  }
  const payload = {
    messaging_product: 'whatsapp',
    ...recipientFields(to),
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  }
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  if (!res.ok) {
    console.error('Error sending WhatsApp template:', JSON.stringify(data))
    const metaMsg = data?.error?.message ?? data?.error?.error_data?.details ?? JSON.stringify(data)
    return { messageId: null, error: metaMsg }
  }
  return { messageId: data.messages?.[0]?.id ?? null, error: null }
}

export interface AdReferral {
  sourceType?: string  // "ad" | "post" | "unknown"
  sourceId?: string    // ID del anuncio en Meta
  headline?: string    // Título del anuncio
  body?: string        // Cuerpo del anuncio
  ctwaClid?: string    // Click-to-WhatsApp click ID
  sourceUrl?: string   // URL del anuncio
  adTitle?: string     // ads_context_data.ad_title
}

export interface IncomingWhatsAppMessage {
  from: string        // Identificador para responder: teléfono si viene, si no el BSUID
  phone?: string      // Teléfono real (ausente si el usuario ocultó su número con username)
  userId?: string     // BSUID (Meta lo envía siempre desde 2026)
  username?: string   // @username de WhatsApp, si lo configuró
  name: string
  text: string
  messageId: string
  timestamp: string
  channel: 'whatsapp' | 'messenger' | 'instagram'
  mediaType?: 'image' | 'audio' | 'video'
  mediaId?: string   // WhatsApp media_id (requires auth download)
  mediaUrl?: string  // Messenger/Instagram direct URL
  referral?: AdReferral
}

export function parseWebhookPayload(body: Record<string, unknown>): IncomingWhatsAppMessage | null {
  try {
    const entry = (body.entry as Record<string, unknown>[])?.[0]
    const changes = (entry?.changes as Record<string, unknown>[])?.[0]
    const value = changes?.value as Record<string, unknown>

    const message = (value?.messages as Record<string, unknown>[])?.[0]
    if (!message) return null

    const contact = (value?.contacts as Record<string, unknown>[])?.[0]
    const profile = contact?.profile as Record<string, unknown>

    const ref = message.referral as Record<string, unknown> | undefined
    const adsCtx = ref?.ads_context_data as Record<string, unknown> | undefined
    const referral: AdReferral | undefined = ref ? {
      sourceType: ref.source_type as string | undefined,
      sourceId: ref.source_id as string | undefined,
      headline: ref.headline as string | undefined,
      body: ref.body as string | undefined,
      ctwaClid: ref.ctwa_clid as string | undefined,
      sourceUrl: ref.source_url as string | undefined,
      adTitle: (adsCtx?.ad_title as string | undefined) ?? (ref.headline as string | undefined),
    } : undefined

    // Identidad del remitente: el teléfono puede faltar si el usuario tiene username.
    // En ese caso Meta envía el BSUID en from_user_id (mensaje) o user_id (contacto).
    const phone = (message.from as string | undefined) || (contact?.wa_id as string | undefined)
    const userId = (message.from_user_id as string | undefined) || (contact?.user_id as string | undefined)
    const username = profile?.username as string | undefined
    const sender = phone || userId
    if (!sender) return null

    const base = {
      from: sender,
      phone,
      userId,
      username,
      name: (profile?.name as string) || (username ? username.replace(/^@/, '') : '') || 'Desconocido',
      messageId: message.id as string,
      timestamp: message.timestamp as string,
      channel: 'whatsapp' as const,
      referral,
    }

    if (message.type === 'text') {
      return { ...base, text: (message.text as Record<string, unknown>)?.body as string }
    }

    if (message.type === 'image') {
      const img = message.image as Record<string, unknown>
      return {
        ...base,
        text: (img?.caption as string) ?? '',
        mediaType: 'image',
        mediaId: img?.id as string,
      }
    }

    if (message.type === 'audio') {
      const audio = message.audio as Record<string, unknown>
      return { ...base, text: '', mediaType: 'audio', mediaId: audio?.id as string }
    }

    if (message.type === 'video') {
      const video = message.video as Record<string, unknown>
      return { ...base, text: '', mediaType: 'video', mediaId: video?.id as string }
    }

    return null
  } catch {
    return null
  }
}

// ── Messenger & Instagram ──────────────────────────────────────────────────

const META_PAGE_TOKEN = process.env.META_PAGE_ACCESS_TOKEN
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN
const INSTAGRAM_BUSINESS_ID = process.env.INSTAGRAM_BUSINESS_ID

/**
 * El token de Instagram vive en Mongo porque se renueva solo cada 60 días
 * (ver /api/cron/refresh-instagram-token). La variable de entorno es la semilla
 * inicial y el respaldo si la base no responde.
 */
export async function getInstagramToken(): Promise<string | undefined> {
  try {
    const { connectDB } = await import('./mongodb')
    const { AppSetting, INSTAGRAM_TOKEN_KEY } = await import('./models/AppSetting')
    await connectDB()
    const stored = await AppSetting.findOne({ key: INSTAGRAM_TOKEN_KEY })
    if (stored?.value) return stored.value as string
  } catch (err) {
    console.error('No se pudo leer el token de Instagram guardado:', err)
  }
  return INSTAGRAM_TOKEN
}

async function getMetaConfig(channel: 'messenger' | 'instagram') {
  if (channel === 'instagram') {
    const token = await getInstagramToken()
    // Los tokens de "Instagram API con login de Instagram" empiezan por IGAA y solo
    // funcionan contra graph.instagram.com; los de login con Facebook (EAA...) van a
    // graph.facebook.com. La ruta es la misma: /<IG_ID>/messages
    const host = token?.startsWith('IGAA') ? 'graph.instagram.com' : 'graph.facebook.com'
    return {
      token,
      url: `https://${host}/v25.0/${INSTAGRAM_BUSINESS_ID}/messages`,
    }
  }
  return {
    token: META_PAGE_TOKEN,
    url: `https://graph.facebook.com/v25.0/me/messages`,
  }
}

/**
 * A quién se le envía en cada canal.
 * WhatsApp: el teléfono, o el BSUID si el usuario ocultó su número.
 * Messenger/Instagram: el IGSID/PSID, que vive dentro del waId con el prefijo del canal.
 * El campo phone NO se usa aquí: en esos canales no hay teléfono real.
 */
export function channelRecipientId(room: { channel: string; phone?: string; waId: string }): string {
  if (room.channel === 'whatsapp') return room.phone || room.waId
  const [, ...rest] = room.waId.split(':')
  return rest.length > 0 ? rest.join(':') : room.waId
}

export interface MetaUserProfile {
  name?: string
  username?: string
  profilePic?: string
}

/**
 * El webhook de Instagram/Messenger solo trae el ID del remitente (IGSID / PSID),
 * nunca su nombre. Hay que pedirlo aparte con el token del canal.
 * Solo funciona con usuarios que ya escribieron al negocio.
 */
export async function getMetaUserProfile(
  channel: 'messenger' | 'instagram',
  senderId: string
): Promise<MetaUserProfile | null> {
  try {
    if (channel === 'instagram') {
      const token = await getInstagramToken()
      if (!token) return null
      const host = token.startsWith('IGAA') ? 'graph.instagram.com' : 'graph.facebook.com'
      // username no existe en todas las variantes del nodo: si Meta lo rechaza,
      // se reintenta pidiendo solo lo que siempre está disponible.
      for (const fields of ['name,username,profile_pic', 'name,profile_pic']) {
        const res = await fetch(`https://${host}/v25.0/${senderId}?fields=${fields}&access_token=${token}`)
        const data = await res.json()
        if (res.ok) {
          return { name: data.name, username: data.username, profilePic: data.profile_pic }
        }
        console.error('[Instagram] Error leyendo el perfil:', JSON.stringify(data))
      }
      return null
    }

    if (!META_PAGE_TOKEN) return null
    const res = await fetch(
      `https://graph.facebook.com/v25.0/${senderId}?fields=first_name,last_name,profile_pic&access_token=${META_PAGE_TOKEN}`
    )
    const data = await res.json()
    if (!res.ok) {
      console.error('[Messenger] Error leyendo el perfil:', JSON.stringify(data))
      return null
    }
    return {
      name: [data.first_name, data.last_name].filter(Boolean).join(' ') || undefined,
      profilePic: data.profile_pic,
    }
  } catch (err) {
    console.error(`Error consultando el perfil de ${channel}:`, err)
    return null
  }
}

async function sendMetaMessage(channel: 'messenger' | 'instagram', recipientId: string, text: string): Promise<string | null> {
  const { token, url } = await getMetaConfig(channel)
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
  const { token, url } = await getMetaConfig(channel)
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

    const sender = messaging.sender as Record<string, unknown>
    const base = {
      from: sender.id as string,
      name: 'Desconocido',
      messageId: message.mid as string,
      timestamp: String(messaging.timestamp ?? Date.now()),
      channel,
    }

    if (message.text) {
      return { ...base, text: message.text as string }
    }

    const attachments = message.attachments as Record<string, unknown>[] | undefined
    const attachment = attachments?.[0]
    if (!attachment) return null

    const attachType = attachment.type as string
    const payload = attachment.payload as Record<string, unknown>

    if (attachType === 'image') {
      return { ...base, text: '', mediaType: 'image', mediaUrl: payload?.url as string }
    }
    if (attachType === 'audio') {
      return { ...base, text: '', mediaType: 'audio' }
    }
    if (attachType === 'video') {
      return { ...base, text: '', mediaType: 'video' }
    }

    return null
  } catch {
    return null
  }
}
