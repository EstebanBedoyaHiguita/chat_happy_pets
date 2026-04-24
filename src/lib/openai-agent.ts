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
      description: 'Crea un pedido confirmado. Llama esta función SOLO cuando el cliente haya confirmado explícitamente los productos, cantidad, ciudad y dirección.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Productos del pedido',
            items: {
              type: 'object',
              properties: {
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
      description: 'LLAMA ESTA FUNCIÓN INMEDIATAMENTE cada vez que el cliente mencione cualquier dato: su nombre, el nombre/tipo/edad/peso de cualquiera de sus mascotas, o su dirección. No esperes a tener todos los datos, llámala cada vez que aprendas uno nuevo.',
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
        const items = ((args.items as { productName: string; quantity: number }[]) ?? []).map((item) => {
          const search = normalize(item.productName)
          const found = freshList.find((p) => {
            const n = normalize(p.name as string)
            return n === search || n.includes(search) || search.includes(n)
          })
          const img = Array.isArray(found?.images) ? (found!.images as string[])[0] : ''
          const price = (found?.price as number) ?? 0
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
        const qty = (keyword: string) => {
          const item = items.find(i => sheetNorm(i.name).includes(keyword))
          return item ? item.quantity : ''
        }

        // Snack categories — join names+quantities for column U
        const snackCategories = ['deshidratado', 'snack']
        const snackItems = items.filter(i =>
          snackCategories.some(cat => sheetNorm(i.name).includes(cat))
        )
        const snacksText = snackItems.map(i => `${i.quantity}x ${i.name}`).join(' - ')

        const sheetPayload = {
          fecha: new Date().toLocaleString('es-CO'),
          celular: waId ?? '',
          vend: 'Bot',
          nombreCliente: roomData?.name ?? '',
          pollo:    qty('pollo'),
          fruta:    qty('fruta'),
          cordero:  qty('cordero'),
          res:      qty('res'),
          pez:      qty('pez') || qty('pescado'),
          gPollo:   qty('gato pollo') || qty('g.pll'),
          gTernera: qty('gato ternera') || qty('g.ter') || qty('ternera'),
          salmon:   qty('salmon') || qty('salmón'),
          conejo:   qty('conejo'),
          snacks:   snacksText,
          observaciones: (args.notes as string) ?? '',
          orderNumber,
        }

        const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK
        if (webhookUrl) {
          try {
            console.log('[Sheets webhook] enviando POST:', JSON.stringify(sheetPayload))
            const sheetsRes = await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain' },
              body: JSON.stringify(sheetPayload),
              redirect: 'follow',
            })
            const sheetsText = await sheetsRes.text()
            console.log('[Sheets webhook]', sheetsRes.status, sheetsText)
          } catch (err) {
            console.error('[Sheets webhook error]', err)
          }
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
          const update: Record<string, string> = {}
          const fields = ['name','petType','petName','petAge','petWeight','pet2Type','pet2Name','pet2Age','pet2Weight','pet3Type','pet3Name','pet3Age','pet3Weight','address']
          for (const f of fields) {
            if (args[f]) update[f] = args[f] as string
          }
          if (Object.keys(update).length > 0) {
            await Room.updateOne({ waId }, { $set: update })
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

export async function runAgent(
  userMessage: string,
  conversationHistory: IMessage[],
  systemPrompt: string,
  transferRules: ITransferRule[],
  model = 'gpt-4o-mini',
  temperature = 0.7,
  contextSummary = '',
  waId = '',
  roomData: RoomKnownData = {}
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

PERSONALIDAD Y ESTILO DE CONVERSACIÓN:
- Eres un asesor de nutrición para mascotas, no un vendedor. Tu objetivo es generar confianza y acompañar al cliente, no vender a la fuerza.
- Cuando el cliente te cuente algo sobre su mascota (nombre, edad, peso), primero reacciona con genuino interés y empatía. Luego haz UNA pregunta de valor, como: ¿qué come actualmente?, ¿cómo está su digestión?, ¿le gustaría armar un plan de alimentación personalizado?
- NUNCA muestres productos inmediatamente después de recibir datos de la mascota, a menos que el cliente haya pedido explícitamente ver productos.
- Sé curioso por las mascotas: pregunta sobre su salud, sus gustos, si tiene algún problema digestivo o de peso. Esto construye confianza y te da información para recomendar mejor.
- Cuando el cliente menciona una segunda mascota, reacciona con entusiasmo y pregunta sobre ella también antes de ofrecer nada.
- El tono es cálido, cercano y amable, como un amigo experto en nutrición animal que quiere lo mejor para la mascota.
- Máximo una pregunta por mensaje. No bombardees al cliente con múltiples preguntas a la vez.

FORMATO DE RESPUESTA — CRÍTICO:
- PROHIBIDO usar asteriscos, negritas, cursivas ni ningún markdown. NUNCA escribas **texto** ni *texto*.
- Escribe exactamente como en un WhatsApp real: texto plano, saltos de línea y emojis únicamente.
- Al mostrar un producto NO escribas etiquetas como "Precio:", "Descripción:", "Imagen:". Escribe directamente el valor: el número del precio, el texto de la descripción y la URL de la imagen en líneas separadas.
- Ejemplo correcto de producto:
  🥩 Dieta Barf Pollo
  $4.300 COP
  Una opción económica y deliciosa para tu perro 🐶
  https://url-de-la-imagen.jpg
- Muestra máximo 2 productos por mensaje. Si hay más, pregunta cuál le interesa antes de mostrar los demás.
- NUNCA listes todos los productos de una vez en un solo mensaje.
- NUNCA digas que no puedes mostrar imágenes. Las imágenes se envían automáticamente al cliente. Si te preguntan, confirma que sí las enviaste.
- SIEMPRE llama get_products SIN filtro de categoría para obtener el catálogo completo. El catálogo tiene más de 15 productos — nunca asumas que ya los conoces todos.
- Cuando recibas el resultado de get_products, BUSCA en TODA la lista antes de decir que un producto no existe.
- Si el cliente pregunta por un sabor específico, muestra SOLO ese producto. NUNCA muestres otros cuando piden uno en concreto.
- Si el cliente ya vio un producto y pregunta un detalle puntual, responde del historial sin reenviar la imagen.
- ANTES de enviar cualquier imagen, escribe SIEMPRE 1-2 líneas de texto cálido que introduzcan los productos.
- Para snacks/premios, llama get_products SIN filtro y filtra por category.name del producto.
- NUNCA digas que hay problemas técnicos ni que no puedes obtener precios.
- Si una herramienta retorna {"status":"sin_datos"}, informa amablemente que el catálogo no está disponible.

⚠️ REGLA CRÍTICA — PRODUCTOS E IMÁGENES:
Solo llama get_products y muestra imágenes cuando el cliente haya dicho EXPLÍCITAMENTE en su último mensaje que quiere ver productos ("sí", "muéstrame", "quiero ver", nombre de un sabor). Si tú acabas de hacer una pregunta ("¿quieres ver las opciones?"), ESPERA la respuesta antes de llamar get_products. NUNCA llames get_products en el mismo turno en que haces una pregunta.
Para clientes recurrentes: aunque ya hayan comprado antes, SIEMPRE pregunta primero "¿ya sabes qué vas a pedir o quieres que te muestre las opciones?" y espera su respuesta antes de mostrar cualquier producto.

FLUJO DE PEDIDO — SIGUE ESTE ORDEN EXACTO. NO SALTES NINGÚN PASO:
1. Si el cliente NO ha elegido productos BARF todavía (dijo "quiero hacer un pedido", "comida para X" o algo vago), pregúntale: "¿Ya sabes qué vas a pedir o quieres que te muestre las opciones de dieta BARF?" — espera su respuesta. NO llames get_products aquí. NO ofrezcas snacks todavía.
2. ⚠️ UPSELL OBLIGATORIO — solo cuando el cliente YA ELIGIÓ sus dietas BARF: Ofrece snacks y premios así:
"¿Te gustaría agregar algún premio o snack para complementar la dieta de [nombre mascota]? 🎁 Tenemos tres opciones:
🥩 Deshidratados
💧 Snacks Húmedos
🦴 Snacks
¿Te interesa conocer alguno?"
   - Si el cliente elige una categoría, llama get_products SIN filtro y muestra los de esa categoría por category.name.
   - Si el cliente dice que no quiere snacks (o "no", "así está bien", "solo eso"), pasa al paso 3.
   - NUNCA mezcles productos BARF con snacks en el mismo mensaje.
3. Verifica los DATOS YA GUARDADOS. Si no tienes el nombre del cliente (o dice "Desconocido"), pídelo y llama update_customer_info. Si no tienes la dirección de entrega, pídela y llama update_customer_info. Solo pide lo que no tengas.
4. Llama get_cities y muestra las ciudades disponibles.
5. Cuando el cliente elija la ciudad, muestra el costo de envío de esa zona.
6. Cuando tengas nombre, dirección, productos y ciudad confirmados, pregunta: "¿Confirmamos el pedido?" — NO calcules ni muestres precios todavía, los precios correctos los confirma el sistema.
7. Cuando el cliente diga que sí, llama create_order INMEDIATAMENTE con todos los datos.
8. La herramienta retorna el resumen real del pedido. Muéstraselo al cliente exactamente así:

✅ Pedido registrado #[orderNumber]

[Por cada item en items: "- [quantity] x [name]: $[lineTotal] COP"]
Subtotal: $[subtotal] COP
Envío: $[shipping] COP
Total: $[total] COP

Luego envía SIEMPRE el siguiente mensaje de pago (cópialo tal cual):

💳 Información de pago:
Nuestros domiciliarios NO reciben dinero en efectivo por seguridad. El pedido debe estar cancelado antes de la entrega.

Realiza tu pago por transferencia o consignación a:
🏦 Bancolombia
📋 Cuenta de Ahorros: 80498900287
👤 Esteban Bedoya

Cuando realices el pago, envíanos el comprobante por este mismo chat. ¡Gracias! 🐾

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

  messages.push({ role: 'user', content: userMessage })

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

  const fullText = response.choices[0].message.content ?? ''

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
