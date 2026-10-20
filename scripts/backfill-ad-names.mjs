/**
 * Rellena campaignName / adsetName / adName en las salas y clientes que ya tienen
 * adId pero entraron antes de que se consultara la Graph API.
 *
 * Necesita META_ADS_ACCESS_TOKEN: un token con permiso `ads_read` sobre la cuenta
 * publicitaria dueña de los anuncios. El de WhatsApp y el de página no sirven.
 *
 * Uso:  node --env-file=.env.local scripts/backfill-ad-names.mjs
 *       node --env-file=.env.local scripts/backfill-ad-names.mjs --apply
 *
 * Sin --apply solo muestra qué cambiaría.
 */
import mongoose from 'mongoose'

const APPLY = process.argv.includes('--apply')
const API_VERSION = 'v25.0'

const uri = process.env.MONGODB_URI
const token = process.env.META_ADS_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN
if (!uri) {
  console.error('Falta MONGODB_URI')
  process.exit(1)
}
if (!token) {
  console.error('Falta META_ADS_ACCESS_TOKEN (token con permiso ads_read)')
  process.exit(1)
}

async function fetchAdNames(adId) {
  const url = new URL(`https://graph.facebook.com/${API_VERSION}/${adId}`)
  url.searchParams.set('fields', 'name,adset{name},campaign{name}')
  url.searchParams.set('access_token', token)
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok || data?.error) {
    console.error(`  ✗ ${adId}: ${data?.error?.message ?? res.status}`)
    return null
  }
  return {
    adName: data.name || undefined,
    adsetName: data.adset?.name || undefined,
    campaignName: data.campaign?.name || undefined,
  }
}

await mongoose.connect(uri)
const rooms = mongoose.connection.collection('rooms')
const customers = mongoose.connection.collection('customers')

const adIds = (await rooms.distinct('adId', { adId: { $nin: [null, ''] } })).filter(Boolean)
console.log(`${adIds.length} anuncios distintos en rooms\n`)

let ok = 0
for (const adId of adIds) {
  const names = await fetchAdNames(adId)
  if (!names) continue
  console.log(`  ✓ ${adId} → ${names.campaignName} / ${names.adsetName} / ${names.adName}`)
  ok++
  if (APPLY) {
    await rooms.updateMany({ adId }, { $set: names })
    await customers.updateMany({ adId }, { $set: names })
  }
}

console.log(`\n${ok}/${adIds.length} anuncios resueltos.`)
console.log(APPLY ? 'Cambios aplicados.' : 'Simulación: vuelve a correr con --apply para guardar.')
await mongoose.disconnect()
