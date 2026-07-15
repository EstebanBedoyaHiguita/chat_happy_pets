import { getProducts } from './happy-pets-api'

export interface PricedItem {
  name: string
  price: number
  quantity: number
  lineTotal: number
  image: string
}

export interface RequestedItem {
  productId?: string
  productName: string
  quantity: number
}

type Product = Record<string, unknown>

// Sin tildes: el agente escribe "Salmon"/"Albondigas" y el catálogo "Salmón"/"Albóndigas"
export const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()

// Palabras vacías que no aportan al match
const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'una', 'uno', 'y', 'a'])

export const keyWords = (s: string) =>
  normalize(s).split(' ').filter(w => w.length > 2 && !STOPWORDS.has(w))

export function toProductList(raw: unknown): Product[] {
  if (Array.isArray(raw)) return raw as Product[]
  const data = (raw as { data?: unknown; items?: unknown })?.data ?? (raw as { items?: unknown })?.items
  return Array.isArray(data) ? (data as Product[]) : []
}

export async function fetchProductList(): Promise<Product[]> {
  return toProductList(await getProducts())
}

/**
 * Encuentra el producto del catálogo que corresponde a lo que pidió el agente.
 * Prioridad: _id > nombre exacto > mejor match por palabras clave.
 */
export function matchProduct(freshList: Product[], item: RequestedItem): Product | undefined {
  const search = normalize(item.productName)
  const searchKeys = keyWords(item.productName)

  // 1. Match by _id (most reliable)
  let found = item.productId ? freshList.find((p) => String(p._id) === item.productId) : undefined
  // 2. Fallback: exact name match only (no substring — "Pollo" ⊂ "Pollo Frutas" causes wrong match)
  if (!found) {
    found = freshList.find((p) => normalize(p.name as string) === search)
  }
  // 3. Fallback: best keyword match (highest overlap ratio, not just first ≥60%).
  // Empates se resuelven por el producto con menos palabras propias sin cubrir:
  // "Dieta Barf Pollo con Verdura" empata con "Dieta Barf Pollo" y "Dieta Barf Pollo
  // Frutas" (3/4 cada uno), pero "Frutas" sobra → gana "Dieta Barf Pollo".
  if (!found) {
    let bestScore = 0
    let bestExtras = Infinity
    for (const p of freshList) {
      const productKeys = keyWords(p.name as string)
      const matches = searchKeys.filter(w => productKeys.some(pw => pw.includes(w) || w.includes(pw)))
      const score = searchKeys.length > 0 ? matches.length / searchKeys.length : 0
      if (score < 0.6) continue
      const extras = productKeys.filter(pw => !searchKeys.some(w => pw.includes(w) || w.includes(pw))).length
      if (score > bestScore || (score === bestScore && extras < bestExtras)) {
        bestScore = score
        bestExtras = extras
        found = p
      }
    }
  }
  return found
}

/**
 * Convierte los items que pidió el agente en items con el precio real del catálogo.
 * Único lugar donde se decide un precio: create_order y update_order pasan por aquí.
 */
export function priceItems(freshList: Product[], requested: RequestedItem[], logTag = 'order'): PricedItem[] {
  return (requested ?? []).map((item) => {
    const found = matchProduct(freshList, item)
    const img = Array.isArray(found?.images) ? (found!.images as string[])[0] : ''
    const rawPrice = found?.price
    const price = typeof rawPrice === 'number' ? rawPrice : typeof rawPrice === 'string' ? parseFloat(rawPrice) || 0 : 0
    console.log(`[${logTag}] item="${item.productName}" id=${item.productId} → matched="${found?.name ?? 'NO MATCH'}" price=${price}`)
    const quantity = Number(item.quantity) || 1
    return {
      // Nombre del catálogo, no el que escribió el agente: evita que un nombre inventado
      // ("Dieta Barf Pollo con Verdura") llegue al resumen y a las columnas del Sheet.
      name: (found?.name as string) ?? item.productName,
      price,
      quantity,
      lineTotal: price * quantity,
      image: img,
    }
  })
}

export const sumSubtotal = (items: PricedItem[]) => items.reduce((sum, i) => sum + i.lineTotal, 0)

export interface ItemDiff {
  added: { name: string; quantity: number }[]
  removed: { name: string; quantity: number }[]
  changed: { name: string; from: number; to: number }[]
}

/** Diff entre los items previos y los nuevos, para que el agente le diga al cliente qué cambió. */
export function diffItems(before: PricedItem[], after: PricedItem[]): ItemDiff {
  const key = (n: string) => normalize(n)
  const beforeMap = new Map(before.map(i => [key(i.name), i]))
  const afterMap = new Map(after.map(i => [key(i.name), i]))

  const diff: ItemDiff = { added: [], removed: [], changed: [] }

  for (const [k, item] of afterMap) {
    const prev = beforeMap.get(k)
    if (!prev) diff.added.push({ name: item.name, quantity: item.quantity })
    else if (prev.quantity !== item.quantity) diff.changed.push({ name: item.name, from: prev.quantity, to: item.quantity })
  }
  for (const [k, item] of beforeMap) {
    if (!afterMap.has(k)) diff.removed.push({ name: item.name, quantity: item.quantity })
  }
  return diff
}
