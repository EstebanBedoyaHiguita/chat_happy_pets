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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_products',
      description: 'Obtiene el catálogo de productos de Happy Pets. Puede filtrarse por categoría.',
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
      description: 'Obtiene los productos destacados de la tienda.',
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
      description: 'Obtiene los detalles completos de un producto específico.',
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
]

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
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
      default:
        return 'Tool not found'
    }
    return JSON.stringify(result)
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
  }
}

export interface AgentResponse {
  text: string
  transfer: boolean
  transferReason?: string
}

export async function runAgent(
  userMessage: string,
  conversationHistory: IMessage[],
  systemPrompt: string,
  transferRules: ITransferRule[],
  model = 'gpt-4o',
  temperature = 0.7
): Promise<AgentResponse> {
  const transferInstructions = `

FORMATO DE RESPUESTA:
- Nunca uses sintaxis markdown para imágenes (no uses ![texto](url)). Si quieres compartir la imagen de un producto, escribe la URL directamente en el texto así: "Imagen: https://..."
- Puedes usar texto plano, saltos de línea y emojis. No uses otro tipo de markdown.

IMPORTANTE: Al final de cada respuesta, si detectas alguna de estas situaciones, debes devolver un JSON en la última línea con el formato: {"transfer":true,"reason":"motivo"}
Situaciones que requieren transferencia a humano:
- El cliente confirma un pedido y quiere proceder al pago (intent: order_confirmed)
- El cliente expresa queja, reclamo o insatisfacción (intent: complaint)
- No tienes la información suficiente para ayudar al cliente
Si NO hay que transferir, no incluyas ese JSON.`

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt + transferInstructions },
    ...conversationHistory.slice(-20).map((m) => ({
      role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ]

  let response = await openai.chat.completions.create({
    model,
    temperature,
    messages,
    tools,
    tool_choice: 'auto',
  })

  // Handle tool calls
  while (response.choices[0].finish_reason === 'tool_calls') {
    const assistantMessage = response.choices[0].message
    messages.push(assistantMessage)

    type FnCall = { type: 'function'; id: string; function: { name: string; arguments: string } }
    const toolCalls = ((assistantMessage.tool_calls ?? []) as FnCall[]).filter((tc) => tc.type === 'function')
    for (const toolCall of toolCalls) {
      const args = JSON.parse(toolCall.function.arguments || '{}')
      const result = await executeTool(toolCall.function.name, args)
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      })
    }

    response = await openai.chat.completions.create({
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

  return { text: cleanText, transfer, transferReason }
}
