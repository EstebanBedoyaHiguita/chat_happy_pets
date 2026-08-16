/**
 * Limpia los "teléfonos" que en realidad son IDs de Instagram/Messenger (IGSID/PSID).
 * Antes se guardaban en el campo phone y de ahí pasaban al pedido y a la hoja de cálculo.
 *
 * Uso:  node --env-file=.env.local scripts/clean-non-whatsapp-phones.mjs
 *       node --env-file=.env.local scripts/clean-non-whatsapp-phones.mjs --apply
 *
 * Sin --apply solo muestra qué cambiaría.
 */
import mongoose from 'mongoose'

const APPLY = process.argv.includes('--apply')
const isRealPhone = (v) => /^(57)?3\d{9}$/.test(String(v ?? '').replace(/\D/g, ''))

const uri = process.env.MONGODB_URI
if (!uri) {
  console.error('Falta MONGODB_URI')
  process.exit(1)
}

await mongoose.connect(uri)
const db = mongoose.connection.db

for (const name of ['rooms', 'customers']) {
  const col = db.collection(name)
  // Las salas de Instagram/Messenger tienen el canal en el waId ("instagram:123...")
  const docs = await col
    .find({ $or: [{ channel: { $in: ['instagram', 'messenger'] } }, { waId: /^(instagram|messenger):/ }] })
    .toArray()

  const dirty = docs.filter((d) => d.phone && !isRealPhone(d.phone))
  console.log(`${name}: ${docs.length} de Instagram/Messenger, ${dirty.length} con un ID guardado como teléfono`)
  for (const d of dirty) console.log(`  ${d.waId} → phone: "${d.phone}"`)

  if (APPLY && dirty.length > 0) {
    const res = await col.updateMany(
      { _id: { $in: dirty.map((d) => d._id) } },
      { $set: { phone: '' } }
    )
    console.log(`  actualizados: ${res.modifiedCount}`)
  }
}

if (!APPLY) console.log('\nSimulación. Repite con --apply para guardar los cambios.')
await mongoose.disconnect()
