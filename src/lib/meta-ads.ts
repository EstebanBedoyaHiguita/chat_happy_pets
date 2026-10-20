/**
 * Nombres de campaña / conjunto / anuncio de Meta Ads.
 *
 * El webhook de Click-to-WhatsApp NO trae el nombre del anuncio: solo manda
 * `source_id` (el ID del anuncio), `headline` y `body` (el texto que ve el
 * cliente). El nombre con el que el equipo bautizó el anuncio en el
 * administrador de anuncios solo se obtiene preguntándole a la Graph API por
 * ese ID, y para eso hace falta un token con permiso `ads_read` sobre la cuenta
 * publicitaria dueña del anuncio (el token de WhatsApp/página no lo tiene).
 *
 * Si no hay token o la consulta falla, se devuelve `null` y el resto del flujo
 * sigue igual: la sala guarda el ID y el headline como siempre.
 */

const API_VERSION = 'v25.0'

const ADS_TOKEN =
  process.env.META_ADS_ACCESS_TOKEN ||
  process.env.WHATSAPP_ACCESS_TOKEN ||
  process.env.META_PAGE_ACCESS_TOKEN

export interface AdNames {
  adName?: string
  adsetName?: string
  campaignName?: string
}

// Los nombres de un anuncio casi nunca cambian, así que se cachean en memoria
// para no llamar a Graph en cada mensaje entrante de la misma campaña.
const cache = new Map<string, { value: AdNames | null; at: number }>()
const TTL_MS = 6 * 60 * 60 * 1000

export async function fetchAdNames(adId: string): Promise<AdNames | null> {
  if (!adId || !ADS_TOKEN) return null

  const hit = cache.get(adId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  let value: AdNames | null = null
  try {
    const url = new URL(`https://graph.facebook.com/${API_VERSION}/${adId}`)
    url.searchParams.set('fields', 'name,adset{name},campaign{name}')
    url.searchParams.set('access_token', ADS_TOKEN)

    const res = await fetch(url.toString())
    const data = await res.json()

    if (!res.ok || data?.error) {
      console.error('Meta Ads: no se pudo leer el anuncio', adId, data?.error?.message ?? res.status)
    } else {
      value = {
        adName: data?.name || undefined,
        adsetName: data?.adset?.name || undefined,
        campaignName: data?.campaign?.name || undefined,
      }
      if (!value.adName && !value.adsetName && !value.campaignName) value = null
    }
  } catch (err) {
    console.error('Meta Ads: error consultando el anuncio', adId, err)
  }

  cache.set(adId, { value, at: Date.now() })
  return value
}
