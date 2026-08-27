import { waitUntil } from '@vercel/functions'

interface SheetItem {
  name: string
  quantity: number
}

interface SheetOrderInput {
  orderNumber: string
  customerPhone: string
  customerName: string
  items: SheetItem[]
  address: string
  city?: string
  notes?: string
}

interface SheetOptions {
  /** 'create' agrega una fila nueva; 'update' reescribe la fila con ese orderNumber. */
  action: 'create' | 'update'
  /** Solo se envía en 'create': en un update el Apps Script conserva el vendedor original. */
  vend?: string
}

const sheetNorm = (s: string) => s.toLowerCase()

// Classify by whether the name contains "barf" or "dieta" — snacks never do
const isBarf = (name: string) => sheetNorm(name).includes('barf') || sheetNorm(name).includes('dieta')

/**
 * Arma el payload de columnas del Sheet a partir de un pedido.
 * Compartido por el bot (create_order/update_order) y por la carga manual de asesores.
 */
export function buildSheetPayload(order: SheetOrderInput, opts: SheetOptions) {
  const barfItems = order.items.filter(i => isBarf(i.name))
  const snackItems = order.items.filter(i => !isBarf(i.name))

  const barfQty = (keywords: string[], excludes: string[] = []) => {
    const item = barfItems.find(i => {
      const n = sheetNorm(i.name)
      return keywords.every(k => n.includes(k)) && excludes.every(e => !n.includes(e))
    })
    return item ? item.quantity : ''
  }

  return {
    action: opts.action,
    // En update no se mandan: el Apps Script conserva la fecha y el vendedor originales.
    ...(opts.action === 'create'
      ? {
          fecha: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
          vend: opts.vend ?? 'Bot',
        }
      : {}),
    celular: order.customerPhone ?? '',
    nombreCliente: order.customerName ?? '',
    pollo:    barfQty(['pollo'], ['fruta', 'gato']),
    fruta:    barfQty(['fruta']),
    cordero:  barfQty(['cordero']),
    res:      barfQty(['res']),
    pez:      barfQty(['pescado']) || barfQty(['pez']),
    conejo:   barfQty(['conejo']),
    salmon:   barfQty(['salmon']) || barfQty(['salmón']),
    gPollo:   barfQty(['gato', 'pollo']),
    gTernera: barfQty(['gato', 'ternera']),
    snacks:   snackItems.map(i => `${i.quantity}x ${i.name}`).join(' - '),
    observaciones: [order.address, order.city, order.notes].filter(Boolean).join(' | '),
    tipoPago: 'CX',
    orderNumber: order.orderNumber,
  }
}

/** Envía el payload al Apps Script. No lanza: un fallo del Sheet no debe tumbar el pedido. */
export function sendToSheet(payload: ReturnType<typeof buildSheetPayload>) {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK
  if (!webhookUrl) {
    console.warn('[Sheets webhook] GOOGLE_SHEETS_WEBHOOK no configurado')
    return
  }
  console.log(`[Sheets webhook] ${payload.action} →`, JSON.stringify(payload))
  const sent = fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload),
  })
    .then(async (res) => {
      const text = await res.text().catch(() => '')
      console.log('[Sheets webhook] status:', res.status, 'body:', text.substring(0, 200))
      // El script responde order_not_found si el update no encontró la fila por orderNumber
      if (text.includes('order_not_found')) {
        console.error('[Sheets webhook] fila no encontrada para', payload.orderNumber)
      }
    })
    .catch((err: unknown) => {
      console.error('[Sheets webhook error]', err instanceof Error ? err.message : String(err))
    })

  // En Vercel, la función serverless se congela en cuanto responde: un fetch sin
  // await se queda a medias y el pedido nunca aparece en la hoja. waitUntil
  // mantiene viva la instancia hasta que termine.
  try {
    waitUntil(sent)
  } catch {
    // Fuera del contexto de una request (scripts, tests) waitUntil no aplica.
  }

  return sent
}
