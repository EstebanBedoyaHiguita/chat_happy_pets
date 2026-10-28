/**
 * Del texto que escribe el modelo al texto que le llega al cliente.
 *
 * El prompt prohíbe el markdown y el modelo lo usa igual: `![Nombre](url)`,
 * `[Imagen](url)`, `**negritas**`. Hasta 2026-10-27 nada de eso se limpiaba en código, y
 * el corte por URL (`splitAroundImages`) partía `![Nombre](url)` por la mitad: al
 * cliente le llegaba `![Dieta Barf Pescado](` pegado al texto — 20 mensajes en 7 salas,
 * 6 de ellas de clientes reales.
 *
 * Regla de este archivo: ninguna URL de imagen llega como texto. O se vuelve la foto de
 * una tarjeta, o se borra. Nada aquí impide que el modelo escriba una URL — la foto se
 * envía porque la URL está en su texto (ver la bitácora del 2026-09-04).
 */

const IMAGE_EXT = /\.(?:jpe?g|png|webp|gif)(?:\?|$)/i

function isImageUrl(url: string): boolean {
  return url.includes('res.cloudinary.com') || IMAGE_EXT.test(url)
}

/**
 * Saca la señal de transferencia `{"transfer":true,"reason":"..."}` esté donde esté.
 *
 * Antes solo se reconocía en la última línea y como JSON válido: con un punto al final,
 * dentro de un bloque ``` o con texto después, le llegaba al cliente y además no
 * transfería.
 */
export function extractTransferSignal(text: string): {
  text: string
  transfer: boolean
  reason?: string
} {
  let transfer = false
  let reason: string | undefined

  const cleaned = text.replace(/\{[^{}]*"transfer"\s*:\s*(true|false)[^{}]*\}/gi, (match, value: string) => {
    if (value.toLowerCase() === 'true') {
      transfer = true
      try {
        const parsed = JSON.parse(match) as { reason?: unknown }
        if (!reason && typeof parsed.reason === 'string') reason = parsed.reason
      } catch {
        // JSON mal formado: la intención de transferir es clara igual.
      }
    }
    return ''
  })

  return {
    text: cleaned
      .split('\n')
      .filter((l) => !/^\s*```\w*\s*$/.test(l))
      .join('\n')
      .trim(),
    transfer,
    reason,
  }
}

/**
 * Pasa el texto del modelo a formato de WhatsApp.
 *
 * - `![x](url)` y `[x](url)` de imagen → la URL sola en su propia línea, para que el
 *   corte por URL nunca caiga dentro del markdown.
 * - Una URL de imagen a mitad de línea ("Pollo: https://…") → a su propia línea, que
 *   es la única forma en que `extractImageUrls` la quita del texto.
 * - `[x](url)` que no es imagen → "x url": WhatsApp convierte la URL en enlace.
 * - `**x**` → `*x*` (negrita de WhatsApp); los títulos `#` se quitan.
 */
export function toWhatsAppText(text: string): string {
  return text
    .replace(/!?\[([^\]\n]*)\]\(\s*(https?:\/\/[^\s)]+)\s*\)/g, (_m, alt: string, url: string) => {
      if (isImageUrl(url)) return `\n${url}\n`
      const label = alt.trim()
      return label && label !== url ? `${label} ${url}` : url
    })
    .replace(/[ \t]*(https?:\/\/[^\s<>]+)/g, (match, raw: string) => {
      const url = raw.replace(/[)\].,;:!?]+$/, '')
      return isImageUrl(url) ? `\n${url}\n` : match
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    .replace(/__([^_\n]+)__/g, '_$1_')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Parte el texto del agente en lo que va ANTES de las fotos y lo que va DESPUÉS,
 * usando la posición donde él mismo escribió las URLs.
 *
 * El agente escribe un solo bloque: saludo, los productos (cada uno con su URL) y al
 * final los sabores que van solo en texto. Si eso se manda como un mensaje, el cliente
 * recibe la información de los productos dos veces — una en el texto y otra en el pie
 * de cada foto. Cortando por las URLs, el saludo sale antes, las fotos llevan la
 * información una sola vez, y la cola ("y también tenemos…") sale después.
 */
export function splitAroundImages(
  text: string,
  imageUrls: string[]
): { before: string; after: string } {
  const positions = imageUrls
    .map((url) => text.indexOf(url))
    .filter((at) => at >= 0)

  if (positions.length === 0) return { before: text, after: '' }

  // Se corta SOLO en la primera URL. Todo lo que venga después se conserva junto (las
  // URLs las quita extractImageUrls): así nada de lo que escribió el agente se pierde,
  // ni siquiera lo que haya puesto entre dos fotos.
  const first = Math.min(...positions)
  return { before: text.slice(0, first), after: text.slice(first) }
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

/**
 * Borra lo que queda huérfano cuando una URL sale del texto para volverse foto: la
 * numeración o la viñeta que la precedía ("2. ", "- "), un emoji solo en su línea, un
 * "Imagen:" sin nada al lado.
 */
function dropOrphanLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (!t) return true
      if (/^(?:\d+[.)]|[-•*])\s*$/.test(t)) return false
      if (/^(?:[-•*]\s*)?(?:imagen|foto|img)\s*:?\s*$/i.test(t)) return false
      return /[\p{L}\p{N}]/u.test(t)
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Los dos textos que se envían alrededor de las fotos: `intro` antes, `cola` después.
 * Es lo único que deben usar el webhook y el takeover para mandar la respuesta del bot.
 */
export function buildOutgoingTexts(
  text: string,
  imageUrls: string[]
): { intro: string; cola: string } {
  const split = splitAroundImages(text, imageUrls)
  return {
    intro: dropOrphanLines(extractImageUrls(split.before).cleanText),
    cola: dropOrphanLines(extractImageUrls(split.after).cleanText),
  }
}
