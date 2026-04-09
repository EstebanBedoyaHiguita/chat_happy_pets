import OpenAI from 'openai'
import {
  getProducts,
  getFeaturedProducts,
  getCategories,
  getProductDetail,
  createOrder,
  registerCustomer,
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
      description: 'Obtiene el catálogo de productos de Happy Pets. Cada producto incluye: _id, name, description, price (en pesos colombianos COP), sku, stock, available, images (array de URLs). Puede filtrarse por categoría.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'ID o slug de la categoría para filtrar productos (opcional)',
          },
        },
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
      name: 'create_order',
      description: 'Crea un pedido en el sistema.',
      parameters: {
        type: 'object',
        properties: {
          order_data: {
            type: 'object',
            description: 'Datos del pedido incluyendo items, dirección de envío y cliente',
          },
        },
        required: ['order_data'],
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
      description: 'LLAMA ESTA FUNCIÓN INMEDIATAMENTE cada vez que el cliente mencione cualquier dato: su nombre, el nombre de su mascota, la edad de la mascota, el peso de la mascota o su dirección. No esperes a tener todos los datos, llámala cada vez que aprendas uno nuevo.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre real del cliente' },
          petType: { type: 'string', description: 'Tipo de mascota: Perro o Gato' },
          petName: { type: 'string', description: 'Nombre de la mascota' },
          petAge: { type: 'string', description: 'Edad de la mascota (ej: 8 años)' },
          petWeight: { type: 'string', description: 'Peso de la mascota (ej: 30 kg)' },
          address: { type: 'string', description: 'Direccion de entrega' },
        },
      },
    },
  },
]

async function executeTool(name: string, args: Record<string, unknown>, waId?: string): Promise<string> {
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
      case 'create_order':
        result = await createOrder(args.order_data)
        break
      case 'register_customer':
        result = await registerCustomer(args as Parameters<typeof registerCustomer>[0])
        break
      case 'update_customer_info': {
        if (waId) {
          const { Room } = await import('./models/Room')
          const update: Record<string, string> = {}
          if (args.name) update.name = args.name as string
          if (args.petType) update.petType = args.petType as string
          if (args.petName) update.petName = args.petName as string
          if (args.petAge) update.petAge = args.petAge as string
          if (args.petWeight) update.petWeight = args.petWeight as string
          if (args.address) update.address = args.address as string
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
  name: string
  price: number
  description: string
  imageUrl: string
}

export interface AgentResponse {
  text: string
  transfer: boolean
  transferReason?: string
  imageUrls: string[]
  products: AgentProduct[]
}

export interface RoomKnownData {
  name?: string
  petName?: string
  petType?: string
  petAge?: string
  petWeight?: string
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
  if (roomData.petType) knownLines.push(`- Tipo de mascota: ${roomData.petType}`)
  if (roomData.petName) knownLines.push(`- Nombre de la mascota: ${roomData.petName}`)
  if (roomData.petAge) knownLines.push(`- Edad de la mascota: ${roomData.petAge}`)
  if (roomData.petWeight) knownLines.push(`- Peso de la mascota: ${roomData.petWeight}`)
  if (roomData.address) knownLines.push(`- Dirección de entrega: ${roomData.address}`)

  const transferInstructions = `

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
- NUNCA menciones, listes ni describas productos sin haber llamado PRIMERO a get_products en esta misma respuesta. Aunque los hayas mostrado antes en la conversación, SIEMPRE llama get_products de nuevo para obtener los datos actualizados con imágenes.
- NUNCA digas que hay problemas técnicos o que no puedes obtener precios.
- Si una herramienta retorna {"status":"sin_datos"}, informa amablemente que en este momento no puedes mostrar el catálogo y pide al cliente que intente en un momento.

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

  // Handle tool calls
  while (response.choices[0].finish_reason === 'tool_calls') {
    const assistantMessage = response.choices[0].message
    messages.push(assistantMessage)

    type FnCall = { type: 'function'; id: string; function: { name: string; arguments: string } }
    const toolCalls = ((assistantMessage.tool_calls ?? []) as FnCall[]).filter((tc) => tc.type === 'function')
    for (const toolCall of toolCalls) {
      const args = JSON.parse(toolCall.function.arguments || '{}')
      const result = await executeTool(toolCall.function.name, args, waId)

      // Extract structured product data from catalog calls
      if (toolCall.function.name === 'get_products' || toolCall.function.name === 'get_featured_products') {
        try {
          const products = JSON.parse(result)
          if (Array.isArray(products)) {
            for (const p of products) {
              const img = Array.isArray(p.images) ? p.images[0] : null
              const imageUrl = img ? (img.startsWith('http') ? img : `${HAPPY_PETS_BASE}${img}`) : ''
              collectedProducts.push({
                name: p.name ?? '',
                price: p.price ?? 0,
                description: p.description ?? '',
                imageUrl,
              })
              if (imageUrl) collectedImageUrls.push(imageUrl)
            }
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

  return { text: cleanText, transfer, transferReason, imageUrls: collectedImageUrls, products: collectedProducts }
}
