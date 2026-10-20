import OpenAI from 'openai'
import { waitUntil } from '@vercel/functions'
import { connectDB } from './mongodb'
import { BotOrder } from './models/BotOrder'
import { Room } from './models/Room'
import { Message } from './models/Message'
import { sendWhatsAppMessage, sendWhatsAppTemplate } from './whatsapp'
import {
  SUPPLIER_CONFIRM_TEXT,
  compareWithSupplier,
  renderSupplierMessage,
  supplierTemplateParams,
  type SupplierLine,
} from './supplier-order'

/**
 * Avisa cada pedido al agente de WhatsApp del proveedor y confirma su resumen.
 *
 * Reglas que viven aquí y no en un prompt:
 * - El envío lo decide el código: sale con la plantilla en cuanto se crea el pedido.
 * - De a UN pedido: su resumen trae su propio número, no el nuestro, así que con dos
 *   en vuelo no se sabría cuál está confirmando. El siguiente sale al confirmarse el
 *   anterior (o si el anterior lleva SENT_TIMEOUT_MS sin respuesta).
 * - El modelo solo transcribe su mensaje (tipo + productos + cantidades); la decisión
 *   de confirmar la toma compareWithSupplier(). Lo único que se le responde solo es
 *   SUPPLIER_CONFIRM_TEXT, una vez por pedido: dos bots no pueden quedar en bucle.
 * - Cualquier otra cosa (diferencias, preguntas, silencio) deja el pedido en `review`
 *   y la conversación queda en /chats para que la siga un asesor.
 */

const SENT_TIMEOUT_MS = 2 * 60 * 60 * 1000
const TEMPLATE_NAME = process.env.SUPPLIER_TEMPLATE_NAME || 'pedidos_fiel'
const TEMPLATE_LANG = process.env.SUPPLIER_TEMPLATE_LANG || 'es'

/** Número del agente del proveedor en formato waId (57XXXXXXXXXX). Vacío = apagado. */
export function supplierWaId(): string {
  const digits = (process.env.SUPPLIER_WHATSAPP_NUMBER ?? '').replace(/\D/g, '')
  return /^3\d{9}$/.test(digits) ? `57${digits}` : digits
}

export function isSupplierWaId(id: string): boolean {
  const supplier = supplierWaId()
  return !!supplier && id.replace(/\D/g, '') === supplier
}

let _openai: OpenAI | null = null
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _openai
}

/** La sala del proveedor en /chats. Siempre en `human`: Sara y los proactivos no la tocan. */
async function ensureSupplierRoom() {
  const waId = supplierWaId()
  return Room.findOneAndUpdate(
    { waId },
    {
      $setOnInsert: { waId, channel: 'whatsapp', name: 'Proveedor · pedidos', phone: waId },
      $set: { status: 'human' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
}

async function logOutbound(content: string, waMessageId: string | null) {
  const room = await ensureSupplierRoom()
  await Message.create({
    roomId: room._id,
    direction: 'outbound',
    sender: 'bot',
    content,
    waMessageId: waMessageId ?? undefined,
    timestamp: new Date(),
  })
  await Room.updateOne({ _id: room._id }, { $set: { lastMessage: content, lastMessageAt: new Date() } })
}

async function markReview(orderId: unknown, note: string) {
  console.warn('[supplier] revisar pedido', String(orderId), '→', note)
  await BotOrder.updateOne({ _id: orderId }, { $set: { 'supplier.status': 'review', 'supplier.note': note } })
}

/** Envía el siguiente pedido en cola, si no hay otro esperando respuesta del proveedor. */
async function dispatchNext(): Promise<void> {
  const enVuelo = await BotOrder.findOne({ 'supplier.status': 'sent' }).sort({ 'supplier.sentAt': 1 })
  if (enVuelo) {
    const sentAt = enVuelo.supplier?.sentAt?.getTime() ?? 0
    if (Date.now() - sentAt < SENT_TIMEOUT_MS) return
    await markReview(enVuelo._id, 'El proveedor no respondió el resumen en 2 horas')
  }

  const order = await BotOrder.findOneAndUpdate(
    { 'supplier.status': 'queued', status: { $ne: 'cancelled' } },
    { $set: { 'supplier.status': 'sent', 'supplier.sentAt': new Date() } },
    { sort: { createdAt: 1 }, new: true }
  )
  if (!order) return

  // Se arma al enviar, no al encolar: si el pedido se editó mientras esperaba, sale el actual.
  const params = supplierTemplateParams(order)
  const { messageId, error } = await sendWhatsAppTemplate(supplierWaId(), TEMPLATE_NAME, TEMPLATE_LANG, [
    { type: 'body', parameters: params.map((text) => ({ type: 'text', text })) },
  ])
  if (error) {
    await markReview(order._id, `No se pudo enviar la plantilla al proveedor: ${error}`)
    return dispatchNext()
  }
  console.log('[supplier] enviado', order.orderNumber)
  await logOutbound(renderSupplierMessage(params), messageId)
}

/**
 * Encola el pedido para el proveedor. No lanza y no se espera: como el Sheet, un fallo
 * aquí nunca tumba el pedido.
 */
export function notifySupplier(orderNumber: string): Promise<void> {
  const run = async () => {
    if (!supplierWaId()) {
      console.warn('[supplier] SUPPLIER_WHATSAPP_NUMBER no configurado: no se avisa', orderNumber)
      return
    }
    await connectDB()
    await BotOrder.updateOne(
      { orderNumber, supplier: { $exists: false } },
      { $set: { supplier: { status: 'queued', queuedAt: new Date() } } }
    )
    await dispatchNext()
  }
  const p = run().catch((err: unknown) => {
    console.error('[supplier] error avisando', orderNumber, err instanceof Error ? err.message : String(err))
  })
  try {
    waitUntil(p)
  } catch {
    // Fuera de una request (scripts) waitUntil no aplica.
  }
  return p
}

/**
 * Un pedido que ya le llegó al proveedor y luego se edita o se cancela: el cambio no
 * se le reenvía solo, se marca para que un asesor se lo avise.
 */
export async function flagSupplierChange(orderNumber: string, motivo: string): Promise<void> {
  await connectDB()
  await BotOrder.updateOne(
    { orderNumber, 'supplier.status': { $in: ['sent', 'confirmed'] } },
    { $set: { 'supplier.status': 'review', 'supplier.note': `${motivo} después de enviarse al proveedor: avisarle a mano` } }
  )
}

interface SupplierReading {
  tipo: 'resumen' | 'confirmado' | 'pregunta' | 'otro'
  numeroPedido: string
  productos: SupplierLine[]
}

/** Solo transcribe: qué clase de mensaje es y qué productos y cantidades trae. */
export async function readSupplierMessage(text: string): Promise<SupplierReading> {
  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `Lees mensajes que el agente de pedidos de un proveedor de comida para mascotas le envía a una tienda que le hace pedidos. Clasifica el mensaje:
- "resumen": muestra el resumen de un pedido (productos y cantidades) y pide confirmarlo.
- "confirmado": avisa que el pedido ya quedó registrado, confirmado o programado, sin pedir nada.
- "pregunta": pide un dato, pide los datos del pedido, reporta un problema o pregunta cualquier cosa.
- "otro": saludos, agradecimientos, cortesías como "¿te ayudo con algo más?" o cualquier cosa que no pida un dato concreto.
En "productos" transcribe cada producto del resumen con su nombre tal cual aparece y la cantidad de unidades (el número antes de la "x" o de la presentación; NUNCA un precio). Si no es un resumen, deja la lista vacía.
En "numeroPedido" pon el número de pedido que dé el proveedor, o "" si no da ninguno.`,
      },
      { role: 'user', content: text },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'mensaje_proveedor',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['tipo', 'numeroPedido', 'productos'],
          properties: {
            tipo: { type: 'string', enum: ['resumen', 'confirmado', 'pregunta', 'otro'] },
            numeroPedido: { type: 'string' },
            productos: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['producto', 'cantidad'],
                properties: {
                  producto: { type: 'string' },
                  cantidad: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
  })
  return JSON.parse(res.choices[0]?.message?.content ?? '{"tipo":"otro","numeroPedido":"","productos":[]}')
}

/** Mensaje entrante del número del proveedor. Llega desde el webhook en lugar de runAgent. */
export async function handleSupplierMessage(msg: { text: string; messageId: string; mediaType?: string }) {
  await connectDB()
  const content = msg.text || (msg.mediaType ? `[${msg.mediaType}]` : '')
  const room = await ensureSupplierRoom()
  await Message.create({
    roomId: room._id,
    direction: 'inbound',
    sender: 'user',
    content: content || '[mensaje vacío]',
    waMessageId: msg.messageId,
    timestamp: new Date(),
  })
  await Room.updateOne(
    { _id: room._id },
    {
      $set: {
        lastMessage: content,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(),
        windowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      $inc: { unreadCount: 1 },
    }
  )

  const order = await BotOrder.findOne({ 'supplier.status': 'sent' }).sort({ 'supplier.sentAt': 1 })
  // Sin pedido en vuelo es su cierre del anterior ("quedó programado"): no hay nada que
  // decidir, y es el momento de mandarle el siguiente si había uno en cola.
  if (!order) return dispatchNext()
  if (!msg.text) return markReview(order._id, 'El proveedor respondió con un archivo, no con texto')

  const lectura = await readSupplierMessage(msg.text)
  console.log('[supplier] lectura', order.orderNumber, JSON.stringify(lectura))

  if (lectura.tipo === 'pregunta') {
    return markReview(order._id, `El proveedor preguntó: "${msg.text.slice(0, 200)}"`)
  }
  if (lectura.tipo !== 'resumen') return

  const { ok, diferencias } = compareWithSupplier(order.items, lectura.productos)
  if (!ok) {
    await BotOrder.updateOne(
      { _id: order._id },
      { $set: { 'supplier.supplierOrderNumber': lectura.numeroPedido || undefined } }
    )
    return markReview(order._id, `El resumen del proveedor no cuadra: ${diferencias.join('; ')}`)
  }

  // Se reclama antes de responder: si llegan dos webhooks del mismo resumen, solo uno confirma.
  const reclamado = await BotOrder.findOneAndUpdate(
    { _id: order._id, 'supplier.status': 'sent' },
    {
      $set: {
        'supplier.status': 'confirmed',
        'supplier.confirmedAt': new Date(),
        'supplier.supplierOrderNumber': lectura.numeroPedido || undefined,
        'supplier.note': '',
      },
    }
  )
  if (!reclamado) return

  const waMessageId = await sendWhatsAppMessage(supplierWaId(), SUPPLIER_CONFIRM_TEXT)
  await logOutbound(SUPPLIER_CONFIRM_TEXT, waMessageId)
  if (!waMessageId) {
    return markReview(order._id, 'El resumen cuadraba pero no se pudo enviar la confirmación')
  }
  console.log('[supplier] confirmado', order.orderNumber, '→ proveedor', lectura.numeroPedido)

  // El siguiente NO sale de inmediato: su mensaje de cierre de este pedido se tomaría
  // como respuesta al nuevo. Sale con ese cierre (arriba) o, si no llega, a los 30 s.
  if (await BotOrder.exists({ 'supplier.status': 'queued', status: { $ne: 'cancelled' } })) {
    await new Promise((r) => setTimeout(r, 30_000))
    await dispatchNext()
  }
}
