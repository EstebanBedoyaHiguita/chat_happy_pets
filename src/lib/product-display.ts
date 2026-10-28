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

/**
 * Palabras con que el cliente nombra a cada especie, ya sin tildes. "can" no está:
 * aparece en palabras normales y no hace falta.
 */
const SPECIES_WORDS: Record<PetType, RegExp> = {
  perro: /\b(?:perr[oa]s?|perrit[oa]s?|perric[oa]s?|cachorr[oa]s?|cachorrit[oa]s?|canin[oa]s?)\b/,
  gato: /\b(?:gat[oa]s?|gatit[oa]s?|gatic[oa]s?|michis?|michit[oa]s?|minin[oa]s?|felin[oa]s?)\b/,
}

/** Especies que nombra un texto: "tengo una gatica y un perro" → ['perro', 'gato']. */
export function speciesIn(text: string | undefined): PetType[] {
  const t = normalize(text ?? '')
  return (['perro', 'gato'] as PetType[]).filter((s) => SPECIES_WORDS[s].test(t))
}

/** Cuántos mensajes del cliente hacia atrás se mira para saber de qué especie está hablando. */
const SPECIES_LOOKBACK = 6

/**
 * De qué especie son los productos de ESTE turno.
 *
 * Antes salía solo de `room.petType`, que se llena una vez y no cambia: un cliente que
 * preguntó "¿tienen para gato?" quedaba como Gato para siempre, y si después hablaba de
 * su perro le seguían saliendo las dietas de gato (2026-10-26). Ahora, en este orden:
 *  1. lo que dice este mensaje;
 *  2. lo último que dijo el cliente sobre especies, en sus mensajes recientes;
 *  3. las mascotas registradas en la sala, todas — perro y gato si tiene los dos.
 * Vacío = no se sabe, y entonces no se muestran fotos sino el rango de precios.
 */
export function resolveSpecies(
  message: string,
  recentInbound: string[],
  registered: (string | undefined)[]
): PetType[] {
  const now = speciesIn(message)
  if (now.length > 0) return now
  for (const text of recentInbound.slice(-SPECIES_LOOKBACK).reverse()) {
    const said = speciesIn(text)
    if (said.length > 0) return said
  }
  const pets = new Set(registered.flatMap((r) => speciesIn(r)))
  return (['perro', 'gato'] as PetType[]).filter((s) => pets.has(s))
}

/** Dietas BARF de las especies dadas. Sin especie conocida, las de perro. */
export function barfFor(products: CatalogProduct[], species: PetType[]): CatalogProduct[] {
  const target: PetType[] = species.length > 0 ? species : ['perro']
  return products.filter((p) => isBarf(p) && target.includes(petTypeOf(p)))
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
  /**
   * 'seleccion': el cliente nombró sabores. 'descubrimiento': está mirando el catálogo.
   * 'ninguno': el turno NO va de productos ("no", "2", "gracias") y no se inyecta nada.
   */
  mode: 'seleccion' | 'descubrimiento' | 'ninguno'
  /** En selección, los sabores en juego. Si son varios, hay que desambiguar. */
  selected: CatalogProduct[]
  /** True cuando el cliente fue impreciso ("pollo") y hay más de un sabor posible. */
  ambiguous: boolean
}

/**
 * Palabras que delatan que el turno SÍ es sobre el catálogo. Si el mensaje no trae
 * ninguna de estas ni nombra un sabor, el turno es 'ninguno' y NO se inyecta bloque de
 * productos: un "no", un "2" o un "gracias" caían en descubrimiento y le reabrían la
 * vitrina con la lista de los otros sabores en cada mensaje (2026-09-04).
 * Se pasan por tokens() para que queden singularizadas igual que el mensaje entrante.
 */
const CATALOG_INTENT = new Set(
  tokens(
    'barf dieta dietas comida comidas alimento alimentos precio precios costo costos ' +
      'cuesta cuestan valor valores vale sabor sabores opcion opciones producto productos ' +
      'catalogo menu ver mostrar muestra muestrame ensename foto fotos imagen imagenes ' +
      'otra otras otro otros tienen tienes disponible disponibles ' +
      'perro perros perrito perritos gato gatos gatico gaticos cachorro cachorros'
  )
)

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

  // Un token que identifica a UN SOLO sabor ya es una elección. El cliente responde
  // "Frutas" a "¿cuál te interesa?": no completa los dos tokens de "Pollo Frutas", pero
  // ningún otro sabor lleva "fruta". Sin esto cae en descubrimiento y elegir un sabor le
  // reabre la vitrina entera — pasó el 2026-09-04 con "Frutas".
  const unico =
    full.length === 0 && otherHit === 0
      ? barf.filter((p) =>
          flavorTokens(p.name).some(
            (t) => said.has(t) && barf.filter((q) => flavorTokens(q.name).includes(t)).length === 1
          )
        )
      : []
  if (unico.length > 0) return { mode: 'seleccion', selected: unico, ambiguous: false }

  if (full.length === 0 || otherHit >= bestBarfHit) {
    // Ni sabores ni palabras de catálogo: el turno no va de productos. Se devuelve
    // 'ninguno' para no inyectar nada, en vez de caer en descubrimiento por descarte.
    const hablaDelCatalogo = otherHit > 0 || [...said].some((t) => CATALOG_INTENT.has(t))
    if (!hablaDelCatalogo) return { mode: 'ninguno', selected: [], ambiguous: false }
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

  // Cliente con perro y gato que dice "pollo": existe Dieta Barf Pollo y Gato De Pollo.
  // Se muestran los dos y elige él; nunca se asume una especie.
  const especies = new Set(specific.map(petTypeOf))
  return { mode: 'seleccion', selected: specific, ambiguous: especies.size > 1 }
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
/**
 * Con dos especies en juego los productos van agrupados "Para perro:" / "Para gato:".
 * El nombre del catálogo no dice "perro" ("Dieta Barf Pollo"), así que sin el grupo el
 * modelo no tiene cómo saber de cuál especie es cada uno.
 */
function porEspecie(
  products: CatalogProduct[],
  species: PetType[],
  render: (p: CatalogProduct) => string,
  sep: string
): string {
  if (species.length < 2) return products.map(render).join(sep)
  return species
    .map((s) => {
      const suyos = products.filter((p) => petTypeOf(p) === s)
      return suyos.length ? `Para ${s}:\n${suyos.map(render).join(sep)}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

/**
 * La vitrina con dos especies: los 2 más baratos de cada una, para no pasar de 4 fotos.
 * Con una sola especie, los SHOWCASE_SIZE más baratos de siempre.
 */
export function showcaseFor(barf: CatalogProduct[], species: PetType[]): CatalogProduct[] {
  if (species.length < 2) return showcase(barf)
  return species.flatMap((s) => showcase(barf.filter((p) => petTypeOf(p) === s)).slice(0, 2))
}

export function buildDisplayInstruction(
  decision: DisplayDecision,
  barf: CatalogProduct[],
  species: PetType[]
): string {
  if (barf.length === 0) return ''
  // Turno que no va de productos: sin bloque. Nunca dice "no envíes la URL" — solo
  // se calla, para no poder apagar una foto que el cliente sí pidió.
  if (decision.mode === 'ninguno') return ''

  const prices = barf.map((p) => p.price)
  const rango = `${cop(Math.min(...prices))} a ${cop(Math.max(...prices))}`

  if (decision.mode === 'seleccion') {
    const selected = decision.selected.slice(0, 4)
    const variasEspecies = new Set(selected.map(petTypeOf)).size > 1
    const header = variasEspecies
      ? 'Ese sabor existe para perro y para gato, y no sabes para cuál lo quiere. ' +
        'Muéstrale los dos y pregúntale para cuál es. No elijas tú por él:'
      : decision.ambiguous
        ? 'El cliente nombró un sabor de forma imprecisa y hay más de una opción posible. ' +
          'Muéstrale ESTAS y pregúntale cuál quiere. No elijas tú por él:'
        : 'El cliente nombró estos sabores. Muéstrale SOLO estos y pregúntale si quiere agregar ' +
          'otro sabor. ⛔ NO le pidas cantidades todavía: las cantidades se preguntan UNA sola vez, ' +
          'cuando ya tenga cerrada la lista de sabores:'
    return (
      `PRODUCTOS PARA ESTE TURNO — usa estos precios e imágenes EXACTOS:\n${header}\n` +
      porEspecie(selected, variasEspecies ? species : [], line, '\n\n') +
      `\n\n${CARD_RULE}No listes otros sabores en este mensaje.`
    )
  }

  if (species.length === 0) {
    return (
      `PRODUCTOS PARA ESTE TURNO:\nTodavía no sabes si tiene perro o gato, así que NO muestres productos ni imágenes. ` +
      `Responde con el rango real de precios de las dietas BARF (${rango}) y en el mismo mensaje pregúntale ` +
      `si tiene perro o gato para mostrarle las que le sirven. Nunca condiciones el precio a esa respuesta.`
    )
  }

  const vitrina = showcaseFor(barf, species)
  const resto = barf.filter((p) => !vitrina.includes(p))
  const restoTexto = resto.length
    ? '\nEn tu texto sí menciona estos otros sabores, SOLO por nombre y precio (sin URL, sin foto), ' +
      'y pregúntale si quiere ver alguno:\n' +
      porEspecie(resto, species, (p) => `${p.name} — ${cop(p.price)}`, '\n')
    : ''
  const intro =
    species.length > 1
      ? `El cliente tiene perro y gato, o habló de los dos: muéstrale las opciones de ambos, ` +
        `diciendo cuáles son para perro y cuáles para gato. Estos ${vitrina.length} van con foto:\n`
      : `El cliente está conociendo el catálogo. Estos ${vitrina.length} sabores van con foto:\n`

  return (
    `PRODUCTOS PARA ESTE TURNO — usa estos precios e imágenes EXACTOS:\n` +
    intro +
    porEspecie(vitrina, species, line, '\n\n') +
    `\n\n${CARD_RULE}` +
    restoTexto
  )
}

/**
 * Quita del texto lo que ya viaja en el pie de una foto.
 *
 * Cada producto se envía como tarjeta (foto + nombre + precio + descripción, armada por
 * el webhook). Si el modelo además los escribe, el cliente los lee dos veces — pasó el
 * 2026-09-04. CARD_RULE se lo pide en el prompt y no obedece, así que se hace en código.
 *
 * Borra una línea SOLO si todas sus palabras son de UN producto cuya foto va en este
 * mismo turno. Lo que eso conserva a propósito:
 *  - "Dieta Barf Pescado — $6.400 COP" cuando la foto de Pescado NO va: es la lista de
 *    los otros sabores, la única forma en que el cliente sabe que existen.
 *  - "¿Pollo o Res?": mezcla dos productos, no es el eco de uno.
 *  - "Perfecto, entonces quieres la Dieta Barf Pollo con Frutas": trae palabras propias.
 *  - Cualquier línea con URL: apagar una foto es justo lo que rompió el flujo.
 *
 * También borra la línea que es, palabra por palabra, la descripción de uno de esos
 * productos: el pie de la foto ya la trae ("Nutrición ligera y balanceada…" salía
 * encima de la tarjeta de Pollo, que dice lo mismo).
 */
export function stripCardEcho(
  text: string,
  productos: { name: string; price: number; description?: string }[]
): string {
  if (productos.length === 0) return text

  const RELLENO = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'a', 'en', 'cop'])
  const palabras = (t: string) =>
    t
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(Boolean)

  // Un set POR producto: la línea debe ser de uno solo, no de la mezcla de todos.
  const porProducto = productos.map((p) => {
    const propias = new Set<string>()
    for (const w of palabras(p.name)) propias.add(w)
    for (const w of palabras(String(p.price))) propias.add(w)
    for (const w of palabras(p.price.toLocaleString('es-CO'))) propias.add(w)
    return propias
  })
  // Línea por línea: las descripciones del catálogo traen dos ("🐔 Pollo con verduras"
  // y "Nutrición ligera…"), y el modelo copia una sola.
  const descripciones = new Set(
    productos
      .flatMap((p) => (p.description ?? '').split('\n'))
      .map((l) => palabras(l).join(' '))
      .filter(Boolean)
  )

  return text
    .split('\n')
    .filter((linea) => {
      if (linea.includes('http')) return true
      // "1. Dieta Barf Pollo" o "- Dieta Barf Pollo" es el mismo eco: la numeración no
      // es una palabra propia.
      const contenido = linea.replace(/^\s*(?:\d+[.)]|[-•*])\s+/, '')
      if (descripciones.has(palabras(contenido).join(' '))) return false
      const ws = palabras(contenido).filter((w) => !RELLENO.has(w))
      if (ws.length === 0) return true
      return !porProducto.some((propias) => ws.every((w) => propias.has(w)))
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
