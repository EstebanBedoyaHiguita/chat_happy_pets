import OpenAI from 'openai'
import {
  getProducts,
  getFeaturedProducts,
  getCategories,
  getProductDetail,
  registerCustomer,
  getCities,
  getShippingCost,
} from './happy-pets-api'
import { checkIntentRules } from './transfer-rules'
import type { IMessage, ITransferRule } from '@/types'

let _openai: OpenAI | null = null
function getOpenAI() {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return _openai
}

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_products',
      description: 'Obtiene el catálogo COMPLETO de Happy Pets. Incluye TODOS los productos: Dietas BARF (Pollo, Pollo Frutas, Res, Cordero, Pescado, Salmón, Conejo), Snacks Humedos (Albóndigas), Deshidratados, Snacks. IMPORTANTE: cuando el cliente pregunte por un sabor específico (ej: "conejo"), busca en la lista completa ese producto y muestra ÚNICAMENTE ese producto en tu respuesta. NUNCA muestres otros sabores si el cliente pidió uno específico. SIEMPRE llama esta función antes de decir que un producto no existe.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_featured_products',
      description: 'Obtiene los productos destacados. Cada producto incluye price (en COP), name, images y descripción completa.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_categories',
      description: 'Lista todas las categorías de productos disponibles.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_product_detail',
      description: 'Obtiene los detalles completos de un producto por su _id. Retorna: name, description, price (en pesos colombianos COP), stock, images y más. Usa el _id del producto obtenido con get_products.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'El ID del producto' },
        },
        required: ['product_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_cities',
      description: 'Obtiene las ciudades disponibles para entrega. Cada ciudad incluye _id, name, department y zone (zone1=$10.000, zone2=$15.000). Llama esta función cuando el cliente quiera hacer un pedido para mostrarle las ciudades disponibles.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_order',
      description: 'OBLIGATORIO: Registra el pedido en el sistema. DEBES llamar esta función cuando el cliente confirme el pedido. NUNCA escribas el resumen del pedido sin haber llamado esta función primero. Para cada producto en items, DEBES pasar el productId (_id del producto que obtuviste de get_products) — esto garantiza el precio correcto. Esta función retorna orderNumber, subtotal, shipping y total reales — usa SOLO esos valores en tu respuesta.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Productos del pedido',
            items: {
              type: 'object',
              properties: {
                productId: { type: 'string', description: '_id del producto obtenido de get_products. Inclúyelo siempre que lo tengas disponible para garantizar el precio correcto.' },
                productName: { type: 'string', description: 'Nombre exacto del producto como aparece en el catálogo' },
                quantity: { type: 'number', description: 'Cantidad de paquetes' },
              },
              required: ['productName', 'quantity'],
            },
          },
          cityId: { type: 'string', description: '_id de la ciudad elegida por el cliente' },
          cityName: { type: 'string', description: 'Nombre de la ciudad elegida' },
          department: { type: 'string', description: 'Departamento de la ciudad' },
          address: { type: 'string', description: 'Dirección exacta de entrega' },
          notes: { type: 'string', description: 'Notas adicionales del pedido (opcional)' },
        },
        required: ['items', 'cityId', 'cityName', 'department', 'address'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'register_customer',
      description: 'Registra un nuevo cliente en el sistema.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          password: { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['name', 'email', 'password'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_customer_info',
      description: `LLAMA ESTA FUNCIÓN INMEDIATAMENTE cada vez que aprendas cualquier dato nuevo del cliente o su mascota. Reglas:
1. Nombre de la mascota: en cuanto el cliente lo diga, llama esta función con petName. SIEMPRE.
2. Tipo de mascota: si tú preguntaste "¿cómo se llama tu perrito?" y el cliente respondió con el nombre, ya sabes que es Perro — llama esta función con petType="Perro" y petName=<nombre dado>. No esperes a que el cliente repita "es un perro".
3. Edad y peso: en cuanto los mencione, llama esta función.
4. Dirección: en cuanto el cliente dé la dirección de entrega (ya sea durante el pedido o en cualquier momento), llama esta función con address antes de continuar.
5. Nombre del cliente: en cuanto lo mencione.
No esperes a tener todos los datos. Llámala con cada dato nuevo por separado si es necesario.`,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre real del cliente' },
          petType: { type: 'string', description: 'Tipo de mascota 1: Perro o Gato' },
          petName: { type: 'string', description: 'Nombre de la mascota 1' },
          petAge: { type: 'string', description: 'Edad de la mascota 1 (ej: 8 años)' },
          petWeight: { type: 'string', description: 'Peso de la mascota 1 (ej: 30 kg)' },
          pet2Type: { type: 'string', description: 'Tipo de mascota 2: Perro o Gato' },
          pet2Name: { type: 'string', description: 'Nombre de la mascota 2' },
          pet2Age: { type: 'string', description: 'Edad de la mascota 2' },
          pet2Weight: { type: 'string', description: 'Peso de la mascota 2' },
          pet3Type: { type: 'string', description: 'Tipo de mascota 3: Perro o Gato' },
          pet3Name: { type: 'string', description: 'Nombre de la mascota 3' },
          pet3Age: { type: 'string', description: 'Edad de la mascota 3' },
          pet3Weight: { type: 'string', description: 'Peso de la mascota 3' },
          address: { type: 'string', description: 'Direccion de entrega' },
        },
      },
    },
  },
]

async function executeTool(name: string, args: Record<string, unknown>, waId?: string, _collectedProducts: AgentProduct[] = [], roomData: RoomKnownData = {}): Promise<string> {
  console.log('[Tool call]', name, JSON.stringify(args))
  try {
    let result
    switch (name) {
      case 'get_products':
        result = await getProducts(args.category as string | undefined)
        break
      case 'get_featured_products':
        result = await getFeaturedProducts()
        break
      case 'get_categories':
        result = await getCategories()
        break
      case 'get_product_detail':
        result = await getProductDetail(args.product_id as string)
        break
      case 'get_cities':
        result = await getCities()
        break
      case 'create_order': {
        // Hard block: name is mandatory before creating any order
        const customerName = roomData?.name ?? ''
        if (!customerName || customerName === 'Desconocido') {
          return JSON.stringify({
            status: 'error',
            instruction: 'NO puedes crear el pedido todavía. DEBES preguntarle al cliente su nombre primero. Pregúntale: "Antes de confirmar, ¿me puedes dar tu nombre?" y espera su respuesta. Llama update_customer_info con el nombre antes de intentar create_order de nuevo.',
          })
        }

        const [citiesRaw, freshProductsRaw] = await Promise.allSettled([
          getCities(),
          getProducts(),
        ])

        // Match city by name (fuzzy) to get the real cityId from the database
        const citiesList: Record<string, unknown>[] = citiesRaw.status === 'fulfilled'
          ? (Array.isArray(citiesRaw.value) ? citiesRaw.value : citiesRaw.value?.data ?? [])
          : []
        const cityNameArg = (args.cityName as string) ?? ''
        const normCity = (s: string) => s.toLowerCase().trim()
        const matchedCity = citiesList.find(c =>
          (c._id as string) === (args.cityId as string) ||
          normCity(c.name as string) === normCity(cityNameArg) ||
          normCity(c.name as string).includes(normCity(cityNameArg)) ||
          normCity(cityNameArg).includes(normCity(c.name as string))
        )

        if (!matchedCity && citiesList.length > 0) {
          result = { status: 'error', message: `La ciudad "${cityNameArg}" no está disponible. Ciudades disponibles: ${citiesList.map(c => c.name).join(', ')}.` }
          break
        }

        const realCityId = (matchedCity?._id ?? args.cityId) as string
        let shipping = 10000
        try {
          const shippingRaw = await getShippingCost(realCityId)
          shipping = typeof shippingRaw === 'number' ? shippingRaw : (shippingRaw?.shippingCost ?? shippingRaw?.shipping ?? 10000)
        } catch (e) {
          console.error('[create_order] getShippingCost error:', e)
        }

        const productsResult = freshProductsRaw.status === 'fulfilled' ? freshProductsRaw.value : null
        const freshList: Record<string, unknown>[] = Array.isArray(productsResult)
          ? productsResult
          : Array.isArray(productsResult?.data) ? productsResult.data : []

        const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
        // Palabras vacías que no aportan al match
        const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'una', 'uno', 'y', 'a'])
        const keyWords = (s: string) => normalize(s).split(' ').filter(w => w.length > 2 && !STOPWORDS.has(w))

        const items = ((args.items as { productId?: string; productName: string; quantity: number }[]) ?? []).map((item) => {
          const search = normalize(item.productName)
          const searchKeys = keyWords(item.productName)
          // 1. Match by _id (most reliable)
          let found = item.productId ? freshList.find((p) => String(p._id) === item.productId) : undefined
          // 2. Fallback: exact name match only (no substring — "Pollo" ⊂ "Pollo Frutas" causes wrong match)
          if (!found) {
            found = freshList.find((p) => normalize(p.name as string) === search)
          }
          // 3. Fallback: best keyword match (highest overlap ratio, not just first ≥60%)
          if (!found) {
            let bestScore = 0
            for (const p of freshList) {
              const productKeys = keyWords(p.name as string)
              const matches = searchKeys.filter(w => productKeys.some(pw => pw.includes(w) || w.includes(pw)))
              const score = searchKeys.length > 0 ? matches.length / searchKeys.length : 0
              if (score > bestScore && score >= 0.6) {
                bestScore = score
                found = p
              }
            }
          }
          const img = Array.isArray(found?.images) ? (found!.images as string[])[0] : ''
          const rawPrice = found?.price
          const price = typeof rawPrice === 'number' ? rawPrice : typeof rawPrice === 'string' ? parseFloat(rawPrice) || 0 : 0
          console.log(`[create_order] item="${item.productName}" id=${item.productId} → matched="${found?.name ?? 'NO MATCH'}" price=${price}`)
          return {
            name: item.productName,
            price,
            quantity: item.quantity,
            lineTotal: price * item.quantity,
            image: img,
          }
        })

        const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0)
        const total = subtotal + shipping

        const { BotOrder } = await import('./models/BotOrder')
        const { connectDB } = await import('./mongodb')
        await connectDB()

        const orderNumber = `WA-${Date.now()}`
        await BotOrder.create({
          orderNumber,
          waId: waId ?? '',
          customerName: roomData?.name ?? '',
          customerPhone: waId ?? '',
          items,
          subtotal,
          shipping,
          total,
          shippingAddress: {
            address: args.address as string,
            city: args.cityName as string,
            department: args.department as string,
            notes: (args.notes as string) ?? '',
          },
          status: 'pending',
        })
        
        // Map items to sheet columns by product name
        const sheetNorm = (s: string) => s.toLowerCase()

        // Classify by whether the name contains "barf" or "dieta" — snacks never do
        const isBarf = (name: string) => sheetNorm(name).includes('barf') || sheetNorm(name).includes('dieta')
        const barfItems = items.filter(i => isBarf(i.name))
        const snackItems = items.filter(i => !isBarf(i.name))
        const snacksText = snackItems.map(i => `${i.quantity}x ${i.name}`).join(' - ')

        // Match only within BARF products; exclude lets "Pollo" not match "Pollo con Frutas"
        const barfQty = (keyword: string, exclude?: string) => {
          const item = barfItems.find(i => {
            const n = sheetNorm(i.name)
            return n.includes(keyword) && (!exclude || !n.includes(exclude))
          })
          return item ? item.quantity : ''
        }

        const sheetPayload = {
          fecha: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
          celular: waId ?? '',
          vend: 'Bot',
          nombreCliente: roomData?.name ?? '',
          pollo:    barfQty('pollo', 'fruta'),
          fruta:    barfQty('fruta'),
          cordero:  barfQty('cordero'),
          res:      barfQty('res'),
          pez:      barfQty('pez') || barfQty('pescado'),
          gPollo:   barfQty('gato pollo') || barfQty('g.pll'),
          gTernera: barfQty('gato ternera') || barfQty('g.ter') || barfQty('ternera'),
          salmon:   barfQty('salmon') || barfQty('salmón'),
          conejo:   barfQty('conejo'),
          snacks:   snacksText,
          observaciones: [args.address, args.notes].filter(Boolean).join(' | '),
          orderNumber,
        }

        const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK
        if (webhookUrl) {
          console.log('[Sheets webhook] enviando POST:', JSON.stringify(sheetPayload))
          fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(sheetPayload),
          })
            .then(async (sheetsRes) => {
              const sheetsText = await sheetsRes.text().catch(() => '')
              console.log('[Sheets webhook] status:', sheetsRes.status, 'body:', sheetsText.substring(0, 200))
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err)
              console.error('[Sheets webhook error]', msg)
            })
        } else {
          console.warn('[Sheets webhook] GOOGLE_SHEETS_WEBHOOK no configurado')
        }

        result = {
          success: true,
          orderNumber,
          subtotal,
          shipping,
          total,
          items: items.map(i => ({ name: i.name, quantity: i.quantity, price: i.price, lineTotal: i.lineTotal })),
        }
        break
      }
      case 'register_customer':
        result = await registerCustomer(args as Parameters<typeof registerCustomer>[0])
        break
      case 'update_customer_info': {
        if (waId) {
          const { Room } = await import('./models/Room')
          const { Customer } = await import('./models/Customer')
          const update: Record<string, string> = {}
          const fields = ['name','petType','petName','petAge','petWeight','pet2Type','pet2Name','pet2Age','pet2Weight','pet3Type','pet3Name','pet3Age','pet3Weight','address']
          for (const f of fields) {
            if (args[f]) update[f] = args[f] as string
          }
          if (Object.keys(update).length > 0) {
            await Room.updateOne({ waId }, { $set: update })
            await Customer.findOneAndUpdate(
              { waId },
              { $set: update },
              { upsert: true, new: true, setDefaultsOnInsert: true }
            )
          }
        }
        result = { success: true }
        break
      }
      default:
        return 'Tool not found'
    }
    const json = JSON.stringify(result)
    console.log('[Tool success]', name, json.substring(0, 300))
    return json
  } catch (error) {
    console.error('[Tool ERROR]', name, error instanceof Error ? error.message : error)
    return JSON.stringify({ status: 'sin_datos', instruccion: 'Usa la informacion del sistema para responder. No menciones errores tecnicos.' })
  }
}


export async function summarizeHistory(messages: IMessage[]): Promise<string> {
  if (messages.length === 0) return ''
  const transcript = messages
    .map((m) => {
      const role = m.direction === 'inbound' ? 'Cliente' : m.sender === 'bot' ? 'Bot' : 'Asesor'
      return role + ': ' + m.content.substring(0, 300)
    })
    .join('\n')
  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `Eres un asistente que resume conversaciones de WhatsApp para una tienda de alimentos para mascotas.
Extrae y lista TODOS los hechos mencionados en este formato:
- Tipo de mascota: (perro/gato si se mencionó)
- Nombre de la mascota: (si se mencionó)
- Edad: (si se mencionó)
- Peso: (si se mencionó)
- Alimento actual: (marca/tipo que le dan actualmente)
- Interés del cliente: (qué productos o información pidió)
- Decisiones tomadas: (qué eligió o confirmó)
- Dirección: (si se mencionó)
- Otros datos relevantes: (cualquier otro hecho importante)

Si no se mencionó algún dato, omite esa línea. Máximo 200 palabras en español. Este resumen lo usará el bot para continuar la conversación sin repetir preguntas.`,
      },
      { role: 'user', content: 'Resume esta conversacion:\n' + transcript },
    ],
  })
  return res.choices[0].message.content ?? ''
}

export interface AgentProduct {
  _id: string
  name: string
  price: number
  description: string
  imageUrl: string
  image: string
}

export interface AgentResponse {
  text: string
  transfer: boolean
  transferReason?: string
  imageUrls: string[]
  products: AgentProduct[]
  orderCreated: boolean
}

export interface RoomKnownData {
  name?: string
  petName?: string
  petType?: string
  petAge?: string
  petWeight?: string
  pet2Name?: string
  pet2Type?: string
  pet2Age?: string
  pet2Weight?: string
  pet3Name?: string
  pet3Type?: string
  pet3Age?: string
  pet3Weight?: string
  address?: string
}

function getDeliveryDate(): string {
  const COLOMBIA_TZ = 'America/Bogota'
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: COLOMBIA_TZ }))
  const delivery = new Date(now)
  delivery.setDate(delivery.getDate() + 1)

  // Colombian public holidays 2026 and 2027
  const holidays = new Set([
    '2026-01-01','2026-01-12','2026-03-23','2026-04-02','2026-04-03',
    '2026-05-01','2026-05-18','2026-06-08','2026-06-15','2026-06-29',
    '2026-07-20','2026-08-07','2026-08-17','2026-10-12','2026-11-02',
    '2026-11-16','2026-12-08','2026-12-25',
    '2027-01-01','2027-01-11','2027-03-22','2027-03-25','2027-03-26',
    '2027-05-01','2027-05-10','2027-05-31','2027-06-07','2027-06-28',
    '2027-07-20','2027-08-07','2027-08-16','2027-10-18','2027-11-01',
    '2027-11-15','2027-12-08','2027-12-25',
  ])

  const toDateStr = (d: Date) =>
    d.toLocaleDateString('en-CA', { timeZone: COLOMBIA_TZ }) // YYYY-MM-DD

  for (let i = 0; i < 14; i++) {
    const dow = new Date(delivery.toLocaleString('en-US', { timeZone: COLOMBIA_TZ })).getDay()
    if (dow !== 0 && !holidays.has(toDateStr(delivery))) break
    delivery.setDate(delivery.getDate() + 1)
  }

  const dayNames = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
  const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const local = new Date(delivery.toLocaleString('en-US', { timeZone: COLOMBIA_TZ }))
  return `${dayNames[local.getDay()]} ${local.getDate()} de ${monthNames[local.getMonth()]}`
}

export async function runAgent(
  userMessage: string,
  conversationHistory: IMessage[],
  systemPrompt: string,
  transferRules: ITransferRule[],
  model = 'gpt-4o-mini',
  temperature = 0.7,
  contextSummary = '',
  waId = '',
  roomData: RoomKnownData = {},
  mediaUrl?: string
): Promise<AgentResponse> {
  const summarySection = contextSummary
    ? `\nCONTEXTO PREVIO DE ESTA CONVERSACIÓN (resumen):\n${contextSummary}\n`
    : ''

  const knownLines: string[] = []
  if (roomData.name && roomData.name !== 'Desconocido') knownLines.push(`- Nombre del cliente: ${roomData.name}`)
  if (roomData.address) knownLines.push(`- Dirección de entrega: ${roomData.address}`)
  if (roomData.petType || roomData.petName) knownLines.push(`- Mascota 1: ${[roomData.petType, roomData.petName, roomData.petAge, roomData.petWeight].filter(Boolean).join(', ')}`)
  if (roomData.pet2Type || roomData.pet2Name) knownLines.push(`- Mascota 2: ${[roomData.pet2Type, roomData.pet2Name, roomData.pet2Age, roomData.pet2Weight].filter(Boolean).join(', ')}`)
  if (roomData.pet3Type || roomData.pet3Name) knownLines.push(`- Mascota 3: ${[roomData.pet3Type, roomData.pet3Name, roomData.pet3Age, roomData.pet3Weight].filter(Boolean).join(', ')}`)

  const transferInstructions = `

SALUDO SEGÚN TIPO DE CLIENTE:
- Cliente SIN mascota registrada (no tienes petType ni petName de ninguna mascota): preséntate siempre: "¡Hola [nombre si lo tienes]! Soy Sara, asesora virtual de Happy Pets Family 🐾 ¿En qué te puedo ayudar hoy?"
- Cliente CON mascota registrada: saluda usando su nombre si lo tienes y pregunta por su mascota. Ejemplos:
  • "¡Hola [nombre]! 😊 ¿Cómo está [nombre mascota]? ¿En qué te puedo ayudar hoy?"
  • Sin nombre: "¡Hola de nuevo! ¿Cómo está [nombre mascota]? 🐾 ¿En qué te puedo ayudar?"
- NUNCA uses "Desconocido" como nombre.

⚠️ REGLA CRÍTICA — DATOS DE MASCOTA ANTES DE PRODUCTOS:
Si NO tienes el tipo, nombre, edad Y peso de al menos una mascota, es OBLIGATORIO recopilarlos ANTES de mostrar cualquier producto o continuar el flujo de pedido. Sigue este orden, UNA pregunta por mensaje:
1. "¿Tienes perro o gato?" (o ambos)
2. "¿Cómo se llama tu [perro/gato]?"
3. "¿Cuántos años tiene [nombre]?"
4. "¿Cuánto pesa [nombre]?"
Solo cuando tengas los 4 datos puedes mostrar productos o avanzar al flujo de pedido.
NUNCA saltes al catálogo ni al flujo de pedido si te falta alguno de estos datos.

FORMATO DE RESPUESTA — CRÍTICO:
- PROHIBIDO usar asteriscos, negritas, cursivas ni ningún markdown. NUNCA escribas **texto** ni *texto*.
- Escribe exactamente como en un WhatsApp real: texto plano, saltos de línea y emojis únicamente.
- Al mostrar un producto NO escribas etiquetas como "Precio:", "Descripción:", "Imagen:". Escribe directamente el valor: el número del precio, el texto de la descripción y la URL de la imagen en líneas separadas.
- Ejemplo correcto de producto:
  🥩 Dieta Barf Pollo
  $4.300 COP
  Una opción económica y deliciosa para tu perro 🐶
  https://url-de-la-imagen.jpg
- NUNCA digas que no puedes mostrar imágenes. Las imágenes se envían automáticamente al cliente. Si te preguntan, confirma que sí las enviaste.
- SIEMPRE llama get_products SIN filtro de categoría para obtener el catálogo completo. El catálogo tiene más de 15 productos — nunca asumas que ya los conoces todos.
- Cuando recibas el resultado de get_products, BUSCA en TODA la lista antes de decir que un producto no existe.
- Si el cliente ya vio un producto y pregunta un detalle puntual, responde del historial sin reenviar la imagen.
- ANTES de enviar cualquier imagen, escribe SIEMPRE 1-2 líneas de texto cálido que introduzcan el producto.
- Para snacks/premios, llama get_products SIN filtro y filtra por category.name del producto.
- NUNCA digas que hay problemas técnicos ni que no puedes obtener precios.
- Si una herramienta retorna {"status":"sin_datos"}, informa amablemente que el catálogo no está disponible.

⚠️ REGLA CRÍTICA — CÓMO MOSTRAR DIETAS BARF:
Cuando el cliente quiera ver las opciones de dieta BARF (dijo "sí", "muéstrame", "quiero ver las opciones" o similar):
1. Llama get_products para obtener el catálogo completo.
2. Filtra solo las dietas BARF (excluye snacks, deshidratados, galletas).
3. Muestra exactamente 3 productos BARF con imagen, nombre, precio y descripción corta.
4. Después de los 3 productos, menciona los sabores restantes en texto y pregunta si quiere ver alguno. Ejemplo:
   "También tenemos Cordero, Conejo y Salmón 🐾 ¿Te gustaría que te mostrara alguno de estos?"
5. Cuando el cliente pida ver otro sabor, muestra SOLO ese producto.
6. NUNCA muestres más de 3 productos a la vez.

⚠️ REGLA CRÍTICA — PRODUCTOS E IMÁGENES:
Solo llama get_products y muestra imágenes cuando el cliente haya dicho EXPLÍCITAMENTE en su último mensaje que quiere ver productos ("sí", "muéstrame", "quiero ver", nombre de un sabor). Si tú acabas de hacer una pregunta ("¿quieres ver las opciones?"), ESPERA la respuesta antes de llamar get_products. NUNCA llames get_products en el mismo turno en que haces una pregunta.
Para clientes recurrentes: aunque ya hayan comprado antes, SIEMPRE pregunta primero "¿ya sabes qué vas a pedir o quieres que te muestre las opciones?" y espera su respuesta antes de mostrar cualquier producto.

FLUJO DE PEDIDO — SIGUE ESTE ORDEN EXACTO. NO SALTES NINGÚN PASO:
1. Si el cliente NO ha elegido productos BARF todavía (dijo "quiero hacer un pedido", "comida para X" o algo vago), pregúntale: "¿Ya sabes qué vas a pedir o quieres que te muestre las opciones de dieta BARF?" — espera su respuesta. NO llames get_products aquí. NO ofrezcas snacks todavía.
2. ⚠️ CANTIDADES — OBLIGATORIO ANTES DE CONFIRMAR:
   - Cuando el cliente mencione uno o varios sabores (ej: "pollo" y "res", o "pollo fruta"), trátalo como productos SEPARADOS.
   - "Pollo fruta" o "pollo con frutas" es UN producto: Dieta Barf Pollo con Frutas. "Pollo" solo es otro: Dieta Barf Pollo. NUNCA los fusiones en uno.
   - Si el cliente no indicó la cantidad de algún producto, pregunta SIEMPRE cuántos paquetes quiere de cada uno antes de avanzar.
   - Una vez tengas todos los productos y cantidades, muestra el resumen para que el cliente confirme:
     "Perfecto, entonces tu pedido sería:
     🐔 X paquete(s) Dieta Barf Pollo
     🍎 X paquete(s) Dieta Barf Pollo con Frutas
     ¿Es correcto? 😊"
   - ESPERA que el cliente confirme el resumen antes de continuar.
3. ⚠️ UPSELL DE SNACKS — OBLIGATORIO, NO LO SALTES: Cuando el cliente confirme los productos BARF, ANTES de preguntar dirección o ciudad, ofrece snacks:
"¿Le gustaría agregar algún snack o premio para [nombre mascota]? 🎁 Tenemos:
🥩 Deshidratados
💧 Snacks Húmedos
🦴 Galletas
¿Le interesa conocer alguno?"
   - Si el cliente elige una categoría → llama get_products SIN filtro y muestra solo los productos de esa categoría (filtra por category.name).
   - Si el cliente dice "no", "no gracias", "así está bien", "solo eso" → pasa al paso 4.
   - NUNCA mezcles BARF con snacks en el mismo mensaje.
   - NUNCA pases al paso 4 sin haber ofrecido los snacks primero.
4. ⚠️ DATOS OBLIGATORIOS — NO PUEDES AVANZAR SIN ESTOS:
   a) NOMBRE DEL CLIENTE: si no lo tienes (o dice "Desconocido"), es OBLIGATORIO pedirlo AHORA. No puedes continuar al paso 5 sin el nombre. Cuando el cliente lo dé, llama update_customer_info con name inmediatamente.
   b) DIRECCIÓN: si no la tienes, pídela. Cuando el cliente la dé, confírmala: "¿Tu dirección de entrega es [dirección]?" — espera que el cliente confirme. Cuando confirme, pregunta: "¿Tienes número de apartamento o alguna indicación adicional para la entrega? 🏠" — si el cliente da un dato adicional, agrégalo a la dirección completa. Si dice "no" o "no tengo", continúa. Luego llama update_customer_info con la dirección completa.
   Pide primero el nombre, luego la dirección. Una pregunta a la vez.
5. Llama get_cities y muestra las ciudades disponibles.
6. Cuando el cliente elija la ciudad, muestra el costo de envío de esa zona. Luego pregunta: "¿Confirmamos el pedido con entrega a [dirección]?" — espera que el cliente confirme.
7. ⚠️ ANTES DE LLAMAR create_order verifica que tienes: nombre del cliente, dirección y ciudad. Si falta alguno, pídelo primero. NUNCA llames create_order si el nombre del cliente es "Desconocido" o está vacío. Cuando tengas todo: LLAMA create_order INMEDIATAMENTE. NO escribas nada antes de llamarla. NO inventes precios. NO copies ninguna plantilla.
8. SOLO DESPUÉS de que create_order retorne un resultado, escribe el resumen usando los valores EXACTOS que retornó la herramienta:
   - Usa el orderNumber real retornado — NUNCA escribas "[orderNumber]" literal
   - Usa el lineTotal, subtotal, shipping, total reales retornados — NUNCA los calcules tú
   - Si no llamaste create_order, NO escribas ningún resumen de pedido

Formato del resumen (con valores reales de la herramienta, sin corchetes):
✅ Pedido registrado #(orderNumber real)
- (quantity) x (name): $(lineTotal real) COP
Subtotal: $(subtotal real) COP
Envío: $(shipping real) COP
Total: $(total real) COP

Luego envía SIEMPRE el siguiente mensaje de pago (cópialo tal cual):

💳 Información de pago:
Nuestros domiciliarios NO reciben dinero en efectivo por seguridad. El pedido debe estar cancelado antes de la entrega.

Realiza tu pago por transferencia o consignación a:
🏦 Bancolombia
📋 Cuenta de Ahorros: 80498900287
👤 Esteban Bedoya

Cuando realices el pago, envíanos el comprobante por este mismo chat. ¡Gracias! 🐾

Después del mensaje de pago, envía SIEMPRE este mensaje de entrega:

"📦 Tu pedido llegará el ${getDeliveryDate()}. Recuerda que no realizamos entregas los domingos ni días festivos."

Luego envía SIEMPRE este mensaje de despedida (adapta el nombre de la mascota con el que tengas guardado, si no tienes usa "tu peludo"):

"¡Gracias por confiar en Happy Pets Family para el cuidado de [nombre mascota] 🐾❤️ Para nosotros es un honor acompañarlos en este camino hacia una vida más sana y natural.

Si tienes alguna duda o quieres contarnos cómo está [nombre mascota], aquí estaremos siempre. ¡Hasta pronto! 😊"

IMPORTANTE: Al final de cada respuesta, si detectas alguna de estas situaciones, debes devolver un JSON en la última línea con el formato: {"transfer":true,"reason":"motivo"}
Situaciones que requieren transferencia a humano:
- El cliente expresa queja, reclamo o insatisfacción (intent: complaint)
- El cliente pide explícitamente hablar con una persona
- Hay un problema con el pedido que no puedes resolver
Si NO hay que transferir, no incluyas ese JSON.`

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt + summarySection + transferInstructions },
    ...conversationHistory.slice(-12).map((m) => ({
      role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    })),
  ]

  // Inject known data as a late system message RIGHT before user message so it's fresh
  if (knownLines.length > 0) {
    messages.push({
      role: 'system',
      content: `⚠️ DATOS YA GUARDADOS DEL CLIENTE — NO VOLVER A PREGUNTAR:\n${knownLines.join('\n')}\n\nEstos datos ya los tienes. No los pidas de nuevo. Úsalos cuando sean relevantes para personalizar la respuesta.`,
    })
  }

  if (mediaUrl) {
    messages.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: mediaUrl, detail: 'auto' } },
        { type: 'text', text: userMessage || 'El cliente envió esta imagen.' },
      ],
    })
  } else {
    messages.push({ role: 'user', content: userMessage })
  }

  let response = await getOpenAI().chat.completions.create({
    model,
    temperature,
    messages,
    tools,
    tool_choice: 'auto',
  })

  // Collect product data directly from product tool results
  const collectedImageUrls: string[] = []
  const collectedProducts: AgentProduct[] = []
  const HAPPY_PETS_BASE = process.env.HAPPY_PETS_API_URL ?? ''
  let orderCreated = false

  // Handle tool calls
  while (response.choices[0].finish_reason === 'tool_calls') {
    const assistantMessage = response.choices[0].message
    messages.push(assistantMessage)

    type FnCall = { type: 'function'; id: string; function: { name: string; arguments: string } }
    const toolCalls = ((assistantMessage.tool_calls ?? []) as FnCall[]).filter((tc) => tc.type === 'function')
    for (const toolCall of toolCalls) {
      const args = JSON.parse(toolCall.function.arguments || '{}')
      const result = await executeTool(toolCall.function.name, args, waId, collectedProducts, roomData)

      // Detect successful order creation
      if (toolCall.function.name === 'create_order') {
        try {
          const parsed = JSON.parse(result)
          if (parsed.success === true) orderCreated = true
        } catch { /* ignore */ }
      }

      // Extract structured product data from catalog calls
      if (toolCall.function.name === 'get_products' || toolCall.function.name === 'get_featured_products') {
        try {
          const raw = JSON.parse(result)
          // Handle both plain array and wrapped responses {data:[]} or {items:[]}
          const productList: Record<string, unknown>[] = Array.isArray(raw) ? raw
            : Array.isArray(raw?.data) ? raw.data
            : Array.isArray(raw?.items) ? raw.items
            : []
          for (const p of productList) {
            const img = Array.isArray(p.images) ? (p.images as string[])[0] : null
            const imageUrl = img ? (img.startsWith('http') ? img : `${HAPPY_PETS_BASE}${img}`) : ''
            collectedProducts.push({
              _id: (p._id as string) ?? '',
              name: (p.name as string) ?? '',
              price: (p.price as number) ?? 0,
              description: (p.description as string) ?? '',
              imageUrl,
              image: imageUrl,
            })
            if (imageUrl) collectedImageUrls.push(imageUrl)
          }
        } catch { /* ignore parse errors */ }
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      })
    }

    response = await getOpenAI().chat.completions.create({
      model,
      temperature,
      messages,
      tools,
      tool_choice: 'auto',
    })
  }

  let fullText = response.choices[0].message.content ?? ''

  // Si el bot escribió el template literal sin llamar create_order, borra esa parte
  // para evitar mostrar [orderNumber] al cliente
  if (!orderCreated && fullText.includes('[orderNumber]')) {
    console.error('[AGENT] Bot escribió template de orden sin llamar create_order — se elimina del texto')
    fullText = fullText
      .replace(/✅ Pedido registrado #\[orderNumber\][\s\S]*?(?=💳|$)/u, '')
      .trim()
    if (!fullText) {
      fullText = 'Hubo un problema al registrar el pedido. Por favor intenta de nuevo confirmando los productos, ciudad y dirección.'
    }
  }

  // Only send product cards for products the bot explicitly named in its response.
  // Without this, all 20 catalog items fill collectedProducts and the webhook sends
  // whichever 2 happen to be first — not the ones the bot actually recommended.
  const textLower = fullText.toLowerCase()
  const mentionedProducts = collectedProducts.filter(p =>
    textLower.includes(p.name.toLowerCase())
  )

  // Parse transfer signal from last line
  const lines = fullText.split('\n')
  const lastLine = lines[lines.length - 1].trim()
  let transfer = false
  let transferReason: string | undefined
  let cleanText = fullText

  try {
    if (lastLine.startsWith('{') && lastLine.includes('"transfer"')) {
      const parsed = JSON.parse(lastLine)
      if (parsed.transfer === true) {
        transfer = true
        transferReason = parsed.reason
        cleanText = lines.slice(0, -1).join('\n').trim()
        // Also check intent-based rules
        const intentCheck = checkIntentRules(parsed.reason ?? '', transferRules)
        if (intentCheck.triggered) {
          transfer = true
          transferReason = intentCheck.ruleName
        }
      }
    }
  } catch {
    // No transfer JSON found, that's fine
  }

  return { text: cleanText, transfer, transferReason, imageUrls: collectedImageUrls, products: mentionedProducts, orderCreated }
}
