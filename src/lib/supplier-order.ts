/**
 * Traduce un BotOrder al mensaje que espera el agente de pedidos del proveedor, y
 * compara su resumen contra el pedido. Solo funciones puras: el envío y la lectura de
 * respuestas viven en supplier-dispatch.ts.
 *
 * Existe porque desde 2026-10 el proveedor toma los pedidos con su propio agente de
 * WhatsApp, y hasta ahora cada pedido se le reenviaba a mano.
 */

/**
 * Texto de la plantilla tal como se registra en Meta (/settings/templates, categoría
 * Utilidad, nombre `pedido_proveedor`). El NIT y la forma de pago van fijos; el orden
 * de las variables es el de supplierTemplateParams().
 */
export const SUPPLIER_TEMPLATE_BODY = `Hola, mi NIT es 1128455175 y quiero hacer un pedido.

Teléfono: {{1}}
Nombres: {{2}}
Apellidos: {{3}}
Dirección: {{4}}
Barrio: {{5}}
Ciudad: {{6}}
Productos y cantidades: {{7}}
Forma de pago: Transferencia bancaria`

/** Va siempre en los apellidos: así el proveedor sabe que el pedido es de Happy Pets. */
export const ETIQUETA_HAPPY_PETS = 'Esteban Bedoya'

/** Lo que confirma el pedido cuando el resumen del proveedor cuadra. */
export const SUPPLIER_CONFIRM_TEXT = 'Sí, todo en orden. Confirmo el pedido ✅'

interface SupplierOrderInput {
  customerName: string
  customerPhone: string
  waId?: string
  items: { name: string; quantity: number }[]
  shippingAddress: { address: string; city: string }
}

const normalizar = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/**
 * Nuestro "Dieta Barf Pollo" es para ellos "Pollo y Verduras". Se nombra explícito
 * para que nunca se confunda con Pollo Frutas. El resto de sabores lo entienden con
 * nuestro nombre del catálogo.
 */
const NOMBRE_PROVEEDOR: Record<string, string> = {
  'dieta barf pollo': 'Barf Pollo y Verduras',
  'dieta barf pollo frutas': 'Barf Pollo y Frutas',
}

export function supplierProductName(name: string): string {
  return NOMBRE_PROVEEDOR[normalizar(name)] ?? name.trim()
}

/** Meta rechaza parámetros con saltos de línea, tabs o más de 4 espacios seguidos, y vacíos. */
function param(value: string, fallback = '-'): string {
  const limpio = value.replace(/\s+/g, ' ').trim()
  return limpio || fallback
}

const capitalizar = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

/**
 * Parte el nombre del cliente en nombres y apellidos. Con 4 palabras o más, las dos
 * primeras son nombres; con menos, solo la primera. Los apellidos llevan siempre la
 * etiqueta de Happy Pets: "Castañeda - Esteban Bedoya", o solo la etiqueta si el
 * cliente no dio apellido.
 */
export function splitCustomerName(fullName: string): { nombres: string; apellidos: string } {
  // Sin emojis ni signos: "Tavo🙌🏻" → "Tavo", "Esteban.bedoya_H" → "Esteban bedoya H"
  const palabras = fullName
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(capitalizar)
  const corte = palabras.length >= 4 ? 2 : 1
  const nombres = palabras.slice(0, corte).join(' ')
  const apellidos = palabras.slice(corte).join(' ')
  return {
    nombres: nombres || 'Cliente',
    apellidos: apellidos ? `${apellidos} - ${ETIQUETA_HAPPY_PETS}` : ETIQUETA_HAPPY_PETS,
  }
}

/** 10 dígitos, sin el 57: es como lo escriben ellos ("3117648076"). */
export function supplierPhone(phone: string, waId = ''): string {
  for (const candidato of [phone, waId]) {
    const digits = (candidato ?? '').replace(/\D/g, '')
    if (/^573\d{9}$/.test(digits)) return digits.slice(2)
    if (/^3\d{9}$/.test(digits)) return digits
  }
  return (phone || waId).replace(/\D/g, '')
}

/** create_order le pega la ciudad al final de la dirección; aquí la ciudad va aparte. */
export function addressWithoutCity(address: string, city: string): string {
  const ciudad = normalizar(city)
  if (!ciudad) return address.trim()
  const partes = address.split(',').map((p) => p.trim()).filter(Boolean)
  while (partes.length > 1 && normalizar(partes[partes.length - 1]) === ciudad) partes.pop()
  return partes.join(', ')
}

export function supplierProductsLine(items: { name: string; quantity: number }[]): string {
  return items.map((i) => `${i.quantity} ${supplierProductName(i.name)}`).join(', ')
}

/** Las 7 variables de la plantilla, en orden. El barrio va con la ciudad: no lo pedimos. */
export function supplierTemplateParams(order: SupplierOrderInput): string[] {
  const { nombres, apellidos } = splitCustomerName(order.customerName ?? '')
  const ciudad = capitalizar(order.shippingAddress.city?.trim() ?? '')
  return [
    param(supplierPhone(order.customerPhone, order.waId)),
    param(nombres),
    param(apellidos),
    param(addressWithoutCity(order.shippingAddress.address ?? '', ciudad)),
    param(ciudad),
    param(ciudad),
    param(supplierProductsLine(order.items)),
  ]
}

/** El mensaje como lo ve el proveedor: es lo que se guarda en el chat del panel. */
export function renderSupplierMessage(params: string[]): string {
  return SUPPLIER_TEMPLATE_BODY.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? '')
}

// "barf", "dieta" y los conectores no distinguen un sabor de otro
const NO_DISTINGUE = new Set(['barf', 'dieta', 'de', 'y', 'con', 'el', 'la', 'del', 'x'])

const distintivas = (name: string) =>
  normalizar(name).split(' ').filter((w) => w && !NO_DISTINGUE.has(w))

// Nuestros nombres solo dicen "Gato" en los de gato; los de perro no lo dicen. Los
// suyos sí ("- Perro"). Sin esto, Pollo y Verduras de perro y el de gato empatarían.
const especie = (palabras: string[]) => (palabras.includes('gato') ? 'gato' : 'perro')

export interface SupplierLine {
  producto: string
  cantidad: number
}

/**
 * ¿El resumen del proveedor trae exactamente nuestros productos y cantidades?
 *
 * Los precios no se comparan: los suyos son otros. Cada producto nuestro se busca en
 * sus líneas por TODAS sus palabras distintivas, con el nombre que se le envió: así
 * "Barf Pollo y Verduras" exige "verduras" y no se puede emparejar con una línea de
 * Pollo y Frutas. Cualquier duda devuelve diferencias, y el pedido va a un humano.
 */
export function compareWithSupplier(
  ours: { name: string; quantity: number }[],
  theirs: SupplierLine[],
): { ok: boolean; diferencias: string[] } {
  const diferencias: string[] = []
  const usadas = new Set<number>()

  for (const item of ours) {
    const enviado = supplierProductName(item.name)
    const claves = distintivas(enviado)
    const candidatas = theirs
      .map((l, idx) => ({ l, idx, suyas: distintivas(l.producto) }))
      .filter(({ idx, suyas }) =>
        !usadas.has(idx) && claves.every((k) => suyas.includes(k)) && especie(suyas) === especie(claves))

    if (candidatas.length === 0) {
      diferencias.push(`${enviado}: no aparece en su resumen`)
      continue
    }
    if (candidatas.length > 1) {
      diferencias.push(`${enviado}: aparece en ${candidatas.length} líneas de su resumen`)
      candidatas.forEach(({ idx }) => usadas.add(idx))
      continue
    }
    const { l, idx } = candidatas[0]
    usadas.add(idx)
    if (l.cantidad !== item.quantity) {
      diferencias.push(`${enviado}: pedimos ${item.quantity}, registró ${l.cantidad}`)
    }
  }

  theirs.forEach((l, idx) => {
    if (!usadas.has(idx)) diferencias.push(`${l.producto} (${l.cantidad}): no lo pedimos`)
  })

  return { ok: diferencias.length === 0, diferencias }
}
