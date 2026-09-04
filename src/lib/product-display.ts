import { normalize } from './order-pricing'
import { getProducts } from './happy-pets-api'

/**
 * Decide QUÉ productos se le muestran al cliente y CUÁNDO.
 *
 * Módulo aparte de `order-pricing.ts` a propósito: allí se decide el PRECIO de un
 * pedido y su matcher recibe siempre el nombre completo del catálogo, que el agente
 * copia del resultado de get_products. Aquí se recibe texto crudo del cliente
 * ("pollo", "me interesa"), que ese matcher resolvería mal: puntúa sobre las palabras
 * de la búsqueda, así que "pollo" empata en todos los productos con pollo y desempata
 * por el nombre más corto — "Albóndigas de pollo" ($8.300) le gana a "Dieta Barf
 * Pollo" ($4.300). Además compara con includes(), así que "me inteRESa" matchea "Res".
 * Por eso este archivo hace su propio match: por token completo y solo sobre BARF.
 */

export interface CatalogProduct {
  _id: string
  name: string
  price: number
  description: string
  imageUrl: string
}

export type PetType = 'perro' | 'gato'

/** Cuántos sabores se muestran con imagen cuando el cliente está conociendo el catálogo. */
export const SHOWCASE_SIZE = 3

/**
 * Desempate de la vitrina cuando dos sabores cuestan lo mismo. Es una decisión
 * comercial, no técnica: hoy Res y Pescado valen $6.400 y se prefiere Res.
 */
const TIEBREAK_PREFERENCE = ['res']

/** Palabras del nombre que no distinguen un sabor de otro. */
const NON_FLAVOR = new Set([
  'dieta', 'barf', 'gato', 'de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'y', 'a',
])

/** El cliente escribe "pollo fruta" y el catálogo dice "Pollo Frutas": singular = plural. */
const singular = (w: string) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)

const tokens = (s: string) =>
  normalize(s).split(/[^a-z0-9]+/).filter(Boolean).map(singular)

/** Tokens que identifican el sabor: "Dieta Barf Gato De Pollo" → ["pollo"]. */
export const flavorTokens = (name: string) => tokens(name).filter((w) => !NON_FLAVOR.has(w))

const isBarf = (p: CatalogProduct) => normalize(p.name).startsWith('dieta barf')

const petTypeOf = (p: CatalogProduct): PetType =>
  tokens(p.name).includes('gato') ? 'gato' : 'perro'

// El catálogo cambia poco y se consulta en cada turno: se cachea en memoria del
// contenedor. En Vercel una instancia caliente reutiliza el valor; una fría lo pide.
// Vencido, se devuelve el valor viejo y se refresca en segundo plano: el backend está
// en Render y un arranque en frío no puede dejar al cliente esperando la respuesta.
let cache: { at: number; products: CatalogProduct[] } | null = null
let refreshing: Promise<CatalogProduct[]> | null = null
const CACHE_MS = 300_000

export async function getCatalog(): Promise<CatalogProduct[]> {
  const fresh = cache && Date.now() - cache.at < CACHE_MS
  if (cache && !fresh && !refreshing) {
    refreshing = fetchCatalog()
      .catch((err) => {
        console.error('[CATALOGO] refresco en segundo plano falló:', err)
        return cache!.products
      })
      .finally(() => {
        refreshing = null
      })
  }
  if (cache) return cache.products
  return fetchCatalog()
}

async function fetchCatalog(): Promise<CatalogProduct[]> {
  const base = process.env.HAPPY_PETS_API_URL ?? ''
  const raw = await getProducts()
  const list: Record<string, unknown>[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown })?.data)
      ? ((raw as { data: unknown[] }).data as Record<string, unknown>[])
      : Array.isArray((raw as { items?: unknown })?.items)
        ? ((raw as { items: unknown[] }).items as Record<string, unknown>[])
        : []

  const products = list.map((p) => {
    const img = Array.isArray(p.images) ? (p.images as string[])[0] : null
    return {
      _id: (p._id as string) ?? '',
      name: (p.name as string) ?? '',
      price: typeof p.price === 'number' ? p.price : Number(p.price) || 0,
      description: (p.description as string) ?? '',
      imageUrl: img ? (img.startsWith('http') ? img : `${base}${img}`) : '',
    }
  })

  // Un catálogo vacío (API caída) no se cachea: se reintenta al turno siguiente.
  if (products.length > 0) cache = { at: Date.now(), products }
  return products
}

/** Dietas BARF del tipo de mascota dado. Sin tipo conocido, las de perro. */
export function barfFor(products: CatalogProduct[], petType?: string): CatalogProduct[] {
  const target: PetType = normalize(petType ?? '').includes('gato') ? 'gato' : 'perro'
  return products.filter((p) => isBarf(p) && petTypeOf(p) === target)
}

/** Los SHOWCASE_SIZE sabores más baratos: los que van con imagen en la vitrina. */
export function showcase(barf: CatalogProduct[]): CatalogProduct[] {
  return [...barf]
    .sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price
      const pref = (p: CatalogProduct) => {
        const i = TIEBREAK_PREFERENCE.findIndex((t) => flavorTokens(p.name).includes(t))
        return i === -1 ? TIEBREAK_PREFERENCE.length : i
      }
      if (pref(a) !== pref(b)) return pref(a) - pref(b)
      return a.name.localeCompare(b.name, 'es')
    })
    .slice(0, SHOWCASE_SIZE)
}

export interface DisplayDecision {
  /** 'seleccion': el cliente nombró sabores. 'descubrimiento': todavía está mirando. */
  mode: 'seleccion' | 'descubrimiento'
  /** En selección, los sabores en juego. Si son varios, hay que desambiguar. */
  selected: CatalogProduct[]
  /** True cuando el cliente fue impreciso ("pollo") y hay más de un sabor posible. */
  ambiguous: boolean
}

/**
 * Decide el modo a partir del mensaje del cliente. Compara por token completo contra
 * los sabores del catálogo, así que "me interesa" no matchea "Res" y "albóndigas de
 * pollo" no entra aquí (no es BARF).
 */
export function decideDisplay(
  message: string,
  barf: CatalogProduct[],
  catalog: CatalogProduct[] = []
): DisplayDecision {
  const said = new Set(tokens(message))

  // Si el cliente nombró algo que NO es BARF y lo nombró con más precisión ("albóndigas
  // de pollo"), no le abrimos la vitrina de dietas por la palabra "pollo": eso lo maneja
  // el flujo de snacks del prompt.
  const barfNames = new Set(barf.map((p) => p.name))
  const otherHit = Math.max(
    0,
    ...catalog
      .filter((p) => !barfNames.has(p.name) && !isBarf(p))
      .map((p) => {
        const f = flavorTokens(p.name)
        return f.length > 0 && f.every((t) => said.has(t)) ? f.length : 0
      })
  )

  // Un producto "matchea" solo si TODOS sus tokens de sabor están en el mensaje.
  const full = barf.filter((p) => {
    const f = flavorTokens(p.name)
    return f.length > 0 && f.every((t) => said.has(t))
  })

  const bestBarfHit = Math.max(0, ...full.map((p) => flavorTokens(p.name).length))
  if (full.length === 0 || otherHit >= bestBarfHit) {
    return { mode: 'descubrimiento', selected: [], ambiguous: false }
  }

  // "pollo con frutas" matchea Pollo y Pollo Frutas: gana el más específico y se
  // descarta el que es subconjunto del otro.
  const specific = full.filter(
    (p) =>
      !full.some((other) => {
        if (other === p) return false
        const a = flavorTokens(p.name)
        const b = flavorTokens(other.name)
        return a.length < b.length && a.every((t) => b.includes(t))
      })
  )

  // "pollo" a secas: es match exacto de "Dieta Barf Pollo", pero también podría
  // referirse a "Pollo Frutas". Se muestran ambos y elige el cliente — nunca se
  // adivina en silencio.
  if (specific.length === 1) {
    const chosen = specific[0]
    const chosenTokens = flavorTokens(chosen.name)
    const siblings = barf.filter(
      (p) =>
        p !== chosen &&
        !full.includes(p) &&
        flavorTokens(p.name).some((t) => chosenTokens.includes(t))
    )
    if (siblings.length > 0) {
      return { mode: 'seleccion', selected: [chosen, ...siblings], ambiguous: true }
    }
  }

  return { mode: 'seleccion', selected: specific, ambiguous: false }
}

const cop = (n: number) => `$${n.toLocaleString('es-CO')} COP`

const line = (p: CatalogProduct) => `${p.name} — ${cop(p.price)}\n${p.imageUrl}`

/**
 * Cada producto sale como una tarjeta (foto + nombre + precio + descripción en el pie),
 * que se envía ANTES del texto. Si el modelo además escribe esos datos, el cliente los
 * lee dos veces — pasó en la prueba del 2026-09-04.
 */
const CARD_RULE =
  'Escribe la URL de cada uno en su propia línea: eso hace que le llegue la foto. ' +
  '⛔ NO escribas el nombre, el precio ni la descripción de esos productos: la foto ya los lleva ' +
  'y repetirlos se los muestra dos veces al cliente. Tu texto es solo la frase que acompaña y la pregunta.\n'

/**
 * Bloque `system` con los productos reales que el agente debe usar en ESTE turno.
 * Lleva precios e imágenes del catálogo, así que el modelo no tiene que llamar
 * get_products para tener datos correctos ni puede inventarse un precio.
 */
export function buildDisplayInstruction(
  decision: DisplayDecision,
  barf: CatalogProduct[],
  petTypeKnown: boolean
): string {
  if (barf.length === 0) return ''

  const prices = barf.map((p) => p.price)
  const rango = `${cop(Math.min(...prices))} a ${cop(Math.max(...prices))}`

  if (decision.mode === 'seleccion') {
    const header = decision.ambiguous
      ? 'El cliente nombró un sabor de forma imprecisa y hay más de una opción posible. ' +
        'Muéstrale ESTAS y pregúntale cuál quiere. No elijas tú por él:'
      : 'El cliente eligió estos sabores. Muéstrale SOLO estos y pregúntale cuántos paquetes quiere de cada uno:'
    return (
      `PRODUCTOS PARA ESTE TURNO — usa estos precios e imágenes EXACTOS:\n${header}\n` +
      decision.selected.slice(0, 4).map(line).join('\n\n') +
      `\n\n${CARD_RULE}No listes otros sabores en este mensaje.`
    )
  }

  if (!petTypeKnown) {
    return (
      `PRODUCTOS PARA ESTE TURNO:\nTodavía no sabes si tiene perro o gato, así que NO muestres productos ni imágenes. ` +
      `Responde con el rango real de precios de las dietas BARF (${rango}) y en el mismo mensaje pregúntale ` +
      `si tiene perro o gato para mostrarle las que le sirven. Nunca condiciones el precio a esa respuesta.`
    )
  }

  const vitrina = showcase(barf)
  const resto = barf.filter((p) => !vitrina.includes(p))
  const restoTexto = resto.length
    ? '\nEn tu texto sí menciona estos otros sabores, SOLO por nombre y precio (sin URL, sin foto), ' +
      'y pregúntale si quiere ver alguno:\n' +
      resto.map((p) => `${p.name} — ${cop(p.price)}`).join('\n')
    : ''

  return (
    `PRODUCTOS PARA ESTE TURNO — usa estos precios e imágenes EXACTOS:\n` +
    `El cliente está conociendo el catálogo. Estos ${vitrina.length} sabores van con foto:\n` +
    vitrina.map(line).join('\n\n') +
    `\n\n${CARD_RULE}` +
    restoTexto
  )
}
