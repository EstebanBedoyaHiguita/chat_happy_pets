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
import { diffItems, priceItems, sumSubtotal, toProductList, type PricedItem, type RequestedItem } from './order-pricing'
import { buildSheetPayload, sendToSheet } from './sheet-payload'
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
      description: 'OBLIGATORIO: Registra un pedido NUEVO en el sistema. DEBES llamar esta función cuando el cliente confirme el pedido. NUNCA escribas el resumen del pedido sin haber llamado esta función primero. Para cada producto en items, DEBES pasar el productId (_id del producto que obtuviste de get_products) — esto garantiza el precio correcto. Esta función retorna orderNumber, subtotal, shipping y total reales — usa SOLO esos valores en tu respuesta.\n\n⚠️ Si el cliente quiere MODIFICAR un pedido que ya hizo, NO uses esta función: usa update_order. Esta función rechaza el pedido si el cliente ya tiene otro pendiente de entrega: en ese caso no se crea uno nuevo, se le informa al cliente y se transfiere a un asesor.',
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
          phone: { type: 'string', description: 'Celular de contacto del cliente (10 dígitos, empieza por 3). OBLIGATORIO si en DATOS QUE YA CONOCES no aparece "Celular del cliente": en ese caso pídeselo al cliente antes de llamar esta función. Si ya aparece, no lo pidas de nuevo ni lo envíes.' },
          notes: { type: 'string', description: 'Notas adicionales del pedido (opcional)' },
        },
        required: ['items', 'cityId', 'cityName', 'department', 'address'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_order',
      description: 'Busca los pedidos existentes del cliente actual. DEBES llamar esta función cuando el cliente mencione que ya tiene un pedido, quiera pagar un pedido existente, quiera MODIFICAR o CAMBIAR un pedido, pregunte por el estado de un pedido, o diga frases como "vengo a pagar", "quiero pagar mi pedido", "ya hice un pedido", "quiero cambiar mi pedido", "agrégame", "quítame". NO crees un pedido nuevo en ese caso — primero busca el existente. Cada pedido retorna editable=true/false: si es false, NO se puede modificar y debes transferir a un asesor.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_order',
      description: 'Modifica los productos de un pedido existente que ya está registrado. Úsala cuando el cliente quiera agregar productos, quitar productos o cambiar cantidades de un pedido que ya hizo ("agrégame 2 de cordero", "quítame el pescado", "mejor que sean 5 de pollo", "quiero cambiar mi pedido").\n\n⚠️ ANTES de llamarla: llama lookup_order, muéstrale el pedido al cliente y CONFIRMA con él que ese es el pedido que quiere modificar. Nunca la llames sin esa confirmación.\n\n⚠️ items debe ser la lista COMPLETA y FINAL del pedido, no solo lo que cambia. Si el pedido tiene 3 pollo y el cliente pide agregar 2 cordero, envía items=[3x pollo, 2x cordero].\n\nNO sirve para cambiar dirección ni ciudad (eso se transfiere a un asesor) ni para cancelar el pedido. Retorna los totales reales y un objeto changes con lo que cambió — usa SOLO esos valores en tu respuesta.',
      parameters: {
        type: 'object',
        properties: {
          orderNumber: { type: 'string', description: 'Número del pedido a modificar (ej: WA-1784075433077), obtenido de lookup_order y confirmado con el cliente.' },
          items: {
            type: 'array',
            description: 'Lista COMPLETA y final de productos que quedará en el pedido, incluyendo los que no cambiaron.',
            items: {
              type: 'object',
              properties: {
                productId: { type: 'string', description: '_id del producto obtenido de get_products. Inclúyelo siempre que lo tengas disponible para garantizar el precio correcto.' },
                productName: { type: 'string', description: 'Nombre exacto del producto tal como aparece en el catálogo' },
                quantity: { type: 'number', description: 'Cantidad final de este producto en el pedido' },
              },
              required: ['productName', 'quantity'],
            },
          },
          reason: { type: 'string', description: 'Qué pidió cambiar el cliente, en pocas palabras (ej: "agregar 2 cordero"). Se guarda en el historial de ediciones.' },
        },
        required: ['orderNumber', 'items'],
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
6. Celular: si el cliente da un número de contacto, llama esta función con phone de inmediato.
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
          phone: { type: 'string', description: 'Celular de contacto del cliente (10 dígitos, empieza por 3)' },
        },
      },
    },
  },
]

/**
 * Deja el celular en el mismo formato que usa WhatsApp (57XXXXXXXXXX).
 * Devuelve '' si no es un móvil colombiano válido — así un BSUID, una cédula
 * o un número mal dictado nunca terminan como teléfono de entrega.
 */
export function normalizeColombianPhone(value?: string): string {
  if (!value) return ''
  const digits = String(value).replace(/\D/g, '')
  if (/^3\d{9}$/.test(digits)) return `57${digits}`
  if (/^573\d{9}$/.test(digits)) return digits
  return ''
}

interface EditableOrder {
  orderNumber: string
  items: PricedItem[]
  subtotal: number
  shipping: number
  total: number
  status: string
  paid: boolean
}

/**
 * Cualquier pedido del cliente que siga pendiente de entrega, pagado o no.
 * Mientras exista uno, el agente no crea otro: se lo informa al cliente y le
 * ofrece modificar ese (si aún no está pagado) o lo pasa a un asesor.
 */
async function findPendingOrder(waId?: string): Promise<EditableOrder | null> {
  if (!waId) return null
  const { BotOrder } = await import('./models/BotOrder')
  const { connectDB } = await import('./mongodb')
  await connectDB()
  return BotOrder.findOne({ waId, status: 'pending' }).sort({ createdAt: -1 }).lean()
}

async function executeTool(name: string, args: Record<string, unknown>, waId?: string, _collectedProducts: AgentProduct[] = [], roomData: RoomKnownData = {}, pendingSteps: string[] = []): Promise<string> {
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
        // Hard block: pending steps must be completed before creating any order
        if (pendingSteps.length > 0) {
          return JSON.stringify({
            status: 'error',
            instruction: `NO puedes crear el pedido todavía. Hay pasos OBLIGATORIOS que debes completar PRIMERO en este orden:\n${pendingSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nCompleta estos pasos ahora. NO llames create_order hasta haberlos completado.`,
          })
        }
        // Hard block: name is mandatory before creating any order
        const customerName = roomData?.name ?? ''
        if (!customerName || customerName === 'Desconocido') {
          return JSON.stringify({
            status: 'error',
            instruction: 'NO puedes crear el pedido todavía. DEBES preguntarle al cliente su nombre primero. Pregúntale: "Antes de confirmar, ¿me puedes dar tu nombre?" y espera su respuesta. Llama update_customer_info con el nombre antes de intentar create_order de nuevo.',
          })
        }

        // Hard block: sin celular no hay entrega. Los clientes que ocultan su número con
        // username de WhatsApp no traen teléfono en el webhook, así que hay que pedírselo.
        const customerPhone = normalizeColombianPhone(roomData?.phone) || normalizeColombianPhone(args.phone as string | undefined)
        if (!customerPhone) {
          const gaveInvalid = Boolean(args.phone)
          return JSON.stringify({
            status: 'error',
            instruction: gaveInvalid
              ? 'El número que te dieron no es un celular colombiano válido. NO crees el pedido. Dile al cliente: "Ese número no me aparece válido 😅 ¿Me lo confirmas? Deben ser 10 dígitos y empezar por 3." Espera el número correcto, guárdalo con update_customer_info y vuelve a llamar create_order.'
              : 'NO puedes crear el pedido todavía. FALTA el celular de contacto para la entrega. Pregúntale al cliente: "Para coordinar la entrega, ¿a qué número de celular te podemos contactar? 📱" Espera su respuesta, guárdalo con update_customer_info (phone) y vuelve a llamar create_order pasando ese número en phone.',
          })
        }

        // Hard block: mientras haya un pedido pendiente de entrega no se crea otro.
        // La regla equivalente ya existe en el prompt y aun así el agente creaba un
        // segundo pedido. Lo importante es que el cliente SIEMPRE reciba una
        // explicación: antes el agente se quedaba sin saber qué decir.
        {
          const existing = await findPendingOrder(waId)
          if (existing) {
            const detalle = existing.items
              .map((i: PricedItem) => `- ${i.quantity} x ${i.name}: $${i.lineTotal.toLocaleString('es-CO')} COP`)
              .join('\n')
            const resumen = `📦 Pedido #${existing.orderNumber}\n${detalle}\nTotal: $${existing.total.toLocaleString('es-CO')} COP`

            return JSON.stringify({
              status: 'error',
              existingOrderNumber: existing.orderNumber,
              paid: existing.paid,
              instruction: `El cliente YA tiene un pedido pendiente de entrega: #${existing.orderNumber}.\n\nNO crees un pedido nuevo y NO uses ninguna otra herramienta. Respóndele AHORA con este mensaje (mismo contenido, sin markdown), NUNCA te quedes sin responder:\n\n"¡Hola! 😊 Veo que ya tienes un pedido pendiente por entregar 🐾\n\n${resumen}\n\nMientras ese pedido esté pendiente no puedo crearte uno nuevo. Te voy a pasar con un asesor del equipo para que te ayude enseguida 😊"\n\nY agrega SIEMPRE en la ÚLTIMA línea, sin excepción: {"transfer":true,"reason":"cliente con pedido pendiente de entrega"}`,
            })
          }
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

        const freshList = toProductList(freshProductsRaw.status === 'fulfilled' ? freshProductsRaw.value : null)
        const items = priceItems(freshList, args.items as RequestedItem[], 'create_order')
        const subtotal = sumSubtotal(items)
        const total = subtotal + shipping

        // Always include city in the stored address
        const rawAddress = (args.address as string) ?? ''
        const cityArg = (args.cityName as string) ?? ''
        const addressWithCity = cityArg && !rawAddress.toLowerCase().includes(cityArg.toLowerCase())
          ? `${rawAddress}, ${cityArg}`
          : rawAddress

        // Persist the full address (with city) to room and customer
        if (waId && (addressWithCity || customerPhone)) {
          const { Room } = await import('./models/Room')
          const { Customer } = await import('./models/Customer')
          const contactUpdate: Record<string, string> = {}
          if (addressWithCity) contactUpdate.address = addressWithCity
          if (customerPhone) contactUpdate.phone = customerPhone
          await Room.updateOne({ waId }, { $set: contactUpdate })
          await Customer.findOneAndUpdate({ waId }, { $set: contactUpdate }, { upsert: true, new: true, setDefaultsOnInsert: true })
        }

        const { BotOrder } = await import('./models/BotOrder')
        const { connectDB } = await import('./mongodb')
        await connectDB()

        const orderNumber = `WA-${Date.now()}`
        await BotOrder.create({
          orderNumber,
          waId: waId ?? '',
          customerName: roomData?.name ?? '',
          customerPhone,
          items,
          subtotal,
          shipping,
          total,
          shippingAddress: {
            address: addressWithCity,
            city: cityArg,
            department: args.department as string,
            notes: (args.notes as string) ?? '',
          },
          status: 'pending',
        })
        
        // addressWithCity ya trae la ciudad, por eso city va vacío: evita repetirla en observaciones
        sendToSheet(buildSheetPayload({
          orderNumber,
          customerPhone,
          customerName: roomData?.name ?? '',
          items,
          address: addressWithCity,
          city: '',
          notes: (args.notes as string) ?? '',
        }, { action: 'create', vend: 'Bot' }))

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
      case 'lookup_order': {
        const { BotOrder } = await import('./models/BotOrder')
        const { connectDB } = await import('./mongodb')
        await connectDB()
        const orders = await BotOrder.find({ waId: waId ?? '' }).sort({ createdAt: -1 }).limit(3).lean()
        if (!orders || orders.length === 0) {
          result = { found: false, message: 'No se encontraron pedidos para este cliente.' }
        } else {
          result = {
            found: true,
            orders: orders.map(o => ({
              orderNumber: o.orderNumber,
              status: o.status,
              paid: o.paid,
              // Solo los editables pueden pasar por update_order; el resto va a asesor humano.
              editable: o.status === 'pending' && !o.paid,
              items: o.items,
              subtotal: o.subtotal,
              shipping: o.shipping,
              total: o.total,
              address: o.shippingAddress?.address,
              createdAt: o.createdAt,
            })),
          }
        }
        break
      }
      case 'update_order': {
        const orderNumber = (args.orderNumber as string) ?? ''
        if (!orderNumber) {
          return JSON.stringify({
            status: 'error',
            instruction: 'Falta orderNumber. Llama lookup_order primero para obtener el número del pedido, confirma con el cliente cuál quiere modificar y vuelve a intentar.',
          })
        }

        const { BotOrder } = await import('./models/BotOrder')
        const { connectDB } = await import('./mongodb')
        await connectDB()
        const order = await BotOrder.findOne({ orderNumber, waId: waId ?? '' })

        if (!order) {
          return JSON.stringify({
            status: 'error',
            instruction: `No existe un pedido #${orderNumber} para este cliente. Llama lookup_order y confirma con el cliente cuál pedido quiere modificar.`,
          })
        }
        // Alcance acordado: el agente solo toca pedidos pendientes sin pagar.
        if (order.status !== 'pending' || order.paid) {
          const motivo = order.paid ? 'ya está pagado' : `está ${order.status === 'delivered' ? 'entregado' : 'cancelado'}`
          return JSON.stringify({
            status: 'error',
            instruction: `El pedido #${orderNumber} ${motivo}, así que NO puedes modificarlo. Dile al cliente: "Ese pedido ${motivo}, así que voy a pasarte con un asesor para que te ayude con el cambio 😊" y transfiere agregando en la ÚLTIMA línea: {"transfer":true,"reason":"modificación de pedido ${motivo}"}`,
          })
        }

        const requested = (args.items as RequestedItem[]) ?? []
        if (requested.length === 0) {
          return JSON.stringify({
            status: 'error',
            instruction: 'items no puede ir vacío. Debes enviar la lista COMPLETA y final de productos que quedará en el pedido (no solo los que cambian). Si el cliente quiere cancelar el pedido completo, transfiere a un asesor.',
          })
        }

        const freshList = toProductList(await getProducts())
        const newItems = priceItems(freshList, requested, 'update_order')
        const previousItems = order.items.map((i: PricedItem) => ({
          name: i.name, price: i.price, quantity: i.quantity, lineTotal: i.lineTotal, image: i.image ?? '',
        }))
        const subtotal = sumSubtotal(newItems)
        // El envío no se recalcula: la ciudad no se puede cambiar por este flujo.
        const shipping = order.shipping
        const total = subtotal + shipping
        const diff = diffItems(previousItems, newItems)

        order.editHistory.push({
          editedAt: new Date(),
          editedBy: 'Bot',
          previousItems,
          previousSubtotal: order.subtotal,
          previousTotal: order.total,
          reason: (args.reason as string) ?? '',
        })
        order.items = newItems
        order.subtotal = subtotal
        order.total = total
        await order.save()

        sendToSheet(buildSheetPayload({
          orderNumber,
          customerPhone: order.customerPhone ?? waId ?? '',
          customerName: order.customerName ?? '',
          items: newItems,
          address: order.shippingAddress?.address ?? '',
          city: '',
          notes: order.shippingAddress?.notes ?? '',
        }, { action: 'update' }))

        result = {
          success: true,
          orderNumber,
          subtotal,
          shipping,
          total,
          items: newItems.map(i => ({ name: i.name, quantity: i.quantity, price: i.price, lineTotal: i.lineTotal })),
          // Diff explícito para que el resumen al cliente diga qué cambió de verdad.
          changes: diff,
          instruction: 'Pedido actualizado. Muéstrale al cliente el resumen NUEVO usando EXACTAMENTE estos valores (mismo formato que un pedido nuevo, pero di "Pedido actualizado" en vez de "Pedido registrado"). NO repitas el mensaje de datos de pago si ya se lo enviaste antes en esta conversación.',
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
          // El celular solo se guarda si es un móvil colombiano válido
          const phone = normalizeColombianPhone(args.phone as string | undefined)
          if (phone) update.phone = phone
          if (Object.keys(update).length > 0) {
            await Room.updateOne({ waId }, { $set: update })
            await Customer.findOneAndUpdate(
              { waId },
              { $set: update },
              { upsert: true, new: true, setDefaultsOnInsert: true }
            )
          }
        }
        // Si intentó guardar un celular y no era válido, el agente debe enterarse
        // en vez de dar el dato por bueno.
        result = args.phone && !normalizeColombianPhone(args.phone as string)
          ? {
              success: true,
              phoneSaved: false,
              instruction: 'El celular NO se guardó porque no es un número válido (deben ser 10 dígitos y empezar por 3). Pídeselo de nuevo al cliente y vuelve a llamar esta función.',
            }
          : { success: true }
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
    // En catálogo se puede seguir con la información del sistema, pero si falló el
    // registro del pedido NO puede darse por hecho: sin esto el agente respondía
    // igual y el cliente recibía la confirmación de un pedido inexistente.
    if (name === 'create_order' || name === 'update_order') {
      return JSON.stringify({
        status: 'error',
        instruction:
          'El pedido NO se pudo registrar. NO le confirmes el pedido al cliente, NO inventes un número de pedido y NO escribas ningún resumen. ' +
          'Dile: "Dame un momento, voy a confirmar tu pedido con un asesor para no equivocarme 😊" y transfiere agregando en la ÚLTIMA línea: {"transfer":true,"reason":"fallo al registrar el pedido"}',
      })
    }
    return JSON.stringify({ status: 'sin_datos', instruccion: 'Usa la informacion del sistema para responder. No menciones errores tecnicos.' })
  }
}


export async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<string | null> {
  try {
    const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('mpeg') ? 'mp3' : 'ogg'
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
    const file = new File([ab], `audio.${ext}`, { type: mimeType })
    const result = await getOpenAI().audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'es',
    })
    return result.text ?? null
  } catch (err) {
    console.error('[Whisper error]', err instanceof Error ? err.message : err)
    return null
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
  phone?: string
  channel?: string
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
  mediaUrl?: string,
  pendingSteps?: string[]
): Promise<AgentResponse> {
  const summarySection = contextSummary
    ? `\nCONTEXTO PREVIO DE ESTA CONVERSACIÓN (resumen):\n${contextSummary}\n`
    : ''

  const knownLines: string[] = []
  if (roomData.name && roomData.name !== 'Desconocido') knownLines.push(`- Nombre del cliente: ${roomData.name}`)
  const knownPhone = normalizeColombianPhone(roomData.phone)
  if (knownPhone) knownLines.push(`- Celular del cliente: ${knownPhone}`)
  if (roomData.address) knownLines.push(`- Dirección de entrega: ${roomData.address}`)
  if (roomData.petType || roomData.petName) knownLines.push(`- Mascota 1: ${[roomData.petType, roomData.petName, roomData.petAge, roomData.petWeight].filter(Boolean).join(', ')}`)
  if (roomData.pet2Type || roomData.pet2Name) knownLines.push(`- Mascota 2: ${[roomData.pet2Type, roomData.pet2Name, roomData.pet2Age, roomData.pet2Weight].filter(Boolean).join(', ')}`)
  if (roomData.pet3Type || roomData.pet3Name) knownLines.push(`- Mascota 3: ${[roomData.pet3Type, roomData.pet3Name, roomData.pet3Age, roomData.pet3Weight].filter(Boolean).join(', ')}`)

  const transferInstructions = `

⛔ REGLA ABSOLUTA — SALUDO OBLIGATORIO EN PRIMER MENSAJE:
Si nunca has enviado un mensaje a este cliente (historial de mensajes salientes vacío), SIEMPRE debes comenzar con el saludo y presentación de Sara ANTES de cualquier otra cosa. Sin excepciones. Aunque el cliente haya mandado producto, cantidad, dirección y nombre todo de una vez, tu primer mensaje SIEMPRE empieza con el saludo. Luego dentro del mismo mensaje respondes o continúas el flujo.

SALUDO SEGÚN TIPO DE CLIENTE:
- Cliente SIN mascota registrada: "¡Hola [nombre si lo tienes]! Soy Sara, asesora virtual de Happy Pets Family 🐾 [continúa respondiendo lo que el cliente necesita en el mismo mensaje]"
- Cliente CON mascota registrada: "¡Hola [nombre]! 😊 ¿Cómo está [nombre mascota]? [continúa respondiendo lo que el cliente necesita]"
- NUNCA uses "Desconocido" como nombre. Si no tienes nombre, saluda sin él.
- NUNCA uses "Desconocido" como nombre.

${knownPhone ? '' : `⚠️ REGLA CRÍTICA — CELULAR DE CONTACTO OBLIGATORIO:
De este cliente NO tenemos su número de celular (no aparece en DATOS QUE YA CONOCES). Sin celular el domiciliario no puede entregar el pedido.${roomData.channel && roomData.channel !== 'whatsapp' ? `\n- Esta conversación es por ${roomData.channel === 'instagram' ? 'Instagram' : 'Messenger'}, donde NUNCA tenemos el número: pedirlo es obligatorio en todos los pedidos de este canal.` : ''}
- Cuando el cliente vaya a hacer un pedido, pídele el celular junto con los datos de entrega: "Para coordinar la entrega, ¿me regalas tu número de celular? 📱"
- En cuanto te lo dé, llama update_customer_info con phone y pásalo también en phone al llamar create_order.
- Deben ser 10 dígitos y empezar por 3. Si te dan algo distinto, pídelo de nuevo amablemente.
- NO pidas el celular al inicio de la conversación ni lo repitas si ya te lo dieron: solo cuando estés recopilando los datos del pedido.

`}⚠️ REGLA CRÍTICA — DATOS DE MASCOTA ANTES DE PRODUCTOS:
Si NO tienes el tipo, nombre, edad Y peso de al menos una mascota, es OBLIGATORIO recopilarlos ANTES de mostrar cualquier producto o continuar el flujo de pedido. Esto aplica SIEMPRE, incluso si el cliente dice "sí" a ver los productos.

Sigue este flujo de dos pasos:
1. Primero pregunta SOLO el tipo: "¿Tienes perro o gato?" (puede tener ambos). Espera la respuesta.
2. Una vez sepas el tipo, pide nombre, edad y peso en UN SOLO mensaje así:
   "Me encantaría darte una recomendación personalizada 🐾 ¿Me regalas estos datos de tu [perro/gato]?
   - Nombre
   - Edad
   - Peso"
   Espera que el cliente responda con los tres datos. Si falta alguno, pídelo en el siguiente mensaje.

Intenta recopilar los datos antes de mostrar productos, pero si el cliente no los da o insiste en ver los productos directamente, muéstralos igual. No te quedes bloqueado pidiendo datos que el cliente no quiere dar.

FORMATO DE RESPUESTA — CRÍTICO:
⛔ PROHIBIDO ABSOLUTAMENTE usar asteriscos, negritas, cursivas ni ningún markdown. NUNCA escribas **texto** ni *texto*. Si lo haces, arruinas la experiencia del cliente en WhatsApp.
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
⛔ NUNCA inventes precios. SOLO usa los precios que retorna get_products. Si el precio de un producto no está en el resultado de get_products, NO lo menciones.

⚠️ REGLA CRÍTICA — CÓMO MOSTRAR DIETAS BARF — LEE COMPLETO ANTES DE RESPONDER:
Hay dos momentos distintos. NUNCA los confundas.

MOMENTO 1 — Cliente pregunta por BARF, precios, dietas o pide información (incluso si es cliente recurrente sin productos elegidos aún):
1. PRIMERO preséntate: "¡Hola [nombre]! Soy Sara, asesora de Happy Pets Family 🐾"
2. Llama get_products y filtra las dietas BARF según el tipo de mascota:
   - Si tiene PERRO (o no sabes el tipo todavía): muestra solo sabores para perro (Pollo, Res, Cordero, Pescado, Salmón, Conejo, Pollo con Frutas). NUNCA muestres los de gato.
   - Si tiene GATO: muestra solo sabores para gato (Gato de Ternera, Gato de Pollo). NUNCA muestres los de perro.
   - Si tiene ambos: muestra primero los de perro y luego los de gato, separados claramente.
3. Lista los sabores correspondientes en TEXTO PLANO, SIN imágenes: nombre, precio y descripción corta.
4. En el MISMO mensaje o en uno separado pregunta cuál le interesa.
⛔ PROHIBIDO mostrar imágenes en este momento. PROHIBIDO enviar productos con foto aquí.

MOMENTO 2 — Cliente menciona o elige un sabor específico (dijo "el de pollo", "la de pollo", "cordero", "salmón", "ese", "sí por favor" + nombre de sabor, "de pescado y conejo", etc.):
⛔ NO des más información en texto. NO listes todos los productos de nuevo.
1. Llama get_products, busca ESE producto y escribe su nombre, precio y la URL real de la imagen en tu respuesta.
2. Si eligió varios sabores, muestra cada uno con su imagen.
3. En el mismo mensaje pregunta cuántos paquetes quiere de cada uno.
⛔ NUNCA muestres más de 4 productos con imagen a la vez.

⛔ NO VENDEMOS AL POR MAYOR: Si el cliente pregunta por precio al por mayor, distribución o compras en grandes cantidades, responde amablemente que solo manejamos venta al detal y ofrece mostrar las opciones disponibles.

⚠️ REGLA CRÍTICA — PRODUCTOS E IMÁGENES:
Puedes llamar get_products en dos casos:
1. El cliente pregunta por precios, dietas o BARF → llama get_products y lista los resultados EN TEXTO con nombre y precio real del catálogo, SIN imágenes. Luego pregunta cuál le interesa.
2. El cliente elige un sabor específico → llama get_products (si no lo tienes ya) y muestra ESE producto con imagen.
⛔ NUNCA muestres imágenes cuando el cliente solo está preguntando por información o precios.
⛔ Si acabas de hacer una pregunta ("¿cuál te interesa?"), ESPERA la respuesta antes de mostrar imágenes.
Para clientes recurrentes: aunque ya hayan comprado antes, SIEMPRE pregunta primero "¿ya sabes qué vas a pedir o quieres que te muestre las opciones?" y espera su respuesta antes de mostrar cualquier producto con imagen.

FLUJO DE PEDIDO — SIGUE ESTE ORDEN EXACTO. NO SALTES NINGÚN PASO:
1. Si el cliente NO ha elegido productos BARF todavía (dijo "quiero hacer un pedido", "comida para X" o algo vago), pregúntale: "¿Ya sabes qué vas a pedir o quieres que te muestre las opciones de dieta BARF?" — espera su respuesta. NO llames get_products aquí. NO ofrezcas snacks todavía.
2. ⚠️ CANTIDADES — OBLIGATORIO ANTES DE CONFIRMAR:
   - Cuando el cliente mencione uno o varios sabores (ej: "pollo" y "res", o "pollo fruta"), muestra PRIMERO la imagen de cada producto seleccionado (incluye la URL en tu respuesta), luego pregunta cuántos paquetes quiere de cada uno.
   - "Pollo fruta" o "pollo con frutas" es UN producto: Dieta Barf Pollo con Frutas. "Pollo" solo es otro: Dieta Barf Pollo. NUNCA los fusiones en uno.
   - Si el cliente no indicó la cantidad de algún producto, pregunta SIEMPRE cuántos paquetes quiere de cada uno antes de avanzar.
   - Una vez tengas todos los productos y cantidades, muestra el resumen para que el cliente confirme:
     "Perfecto, entonces tu pedido sería:
     🐔 X paquete(s) Dieta Barf Pollo
     🍎 X paquete(s) Dieta Barf Pollo con Frutas
     ¿Es correcto? 😊"
   - ⚠️ En este mensaje SOLO va el resumen y "¿Es correcto?". NADA MÁS. No preguntes por apartamento, dirección, nombre ni nada adicional. ESPERA que el cliente confirme antes de continuar.
3. ⚠️ UPSELL DE SNACKS — OBLIGATORIO, NO LO SALTES: Cuando el cliente confirme los productos BARF, debes ofrecer snacks. Esto aplica SIEMPRE, incluso si ya tienes la dirección (porque la recopiló un asesor humano antes). Revisa el historial: si en ningún mensaje previo (tuyo o del asesor) se ofreció snacks, OFRÉCELOS AHORA antes de avanzar al paso 4:
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
   a) NOMBRE DEL CLIENTE: si no lo tienes (o dice "Desconocido"), es OBLIGATORIO pedirlo AHORA. No puedes continuar sin el nombre. Cuando el cliente lo dé, llama update_customer_info con name inmediatamente.
   b) DIRECCIÓN:
      - Si YA tienes la dirección guardada con ciudad incluida (ej: "Calle 45d 6-50, Apto 503, Medellín"): NO preguntes por apartamento ni por ciudad. Ve directamente al paso 5 usando la ciudad que ya está en la dirección.
      - Si tienes dirección pero SIN ciudad: confirma la dirección, pregunta por apartamento si no lo tienes, luego pasa al paso 5.
      - Si NO tienes dirección: pídela. Cuando el cliente la dé, confírmala: "¿Tu dirección de entrega es [dirección]?". Cuando confirme, pregunta en mensaje separado: "¿Tienes número de apartamento o alguna indicación adicional para la entrega? 🏠". Luego pasa al paso 5.
   Pide primero el nombre, luego la dirección. Una pregunta a la vez. La pregunta del apartamento va en mensaje SEPARADO al resumen del pedido.
5. Ciudad y costo de envío:
   - Si la dirección YA incluye la ciudad: llama get_cities solo para obtener el costo de envío de esa ciudad. NO muestres la lista de ciudades. Ve directo al paso 6.
   - Si NO tienes ciudad: llama get_cities y muestra las opciones disponibles para que el cliente elija.
6. Muestra el costo de envío y confirma: "El costo de envío a [ciudad] es de $[costo] COP. ¿Confirmamos el pedido con entrega a [dirección completa]? 😊" — espera que el cliente confirme. Llama update_customer_info con la dirección completa incluyendo ciudad.
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
Manejamos dos opciones de pago, siempre por transferencia (no recibimos efectivo por seguridad):

1️⃣ Pago anticipado: realiza la transferencia antes de la entrega para agilizar el proceso.
2️⃣ Pago contra entrega: puedes hacer la transferencia en el momento en que recibas tu pedido.

Datos para transferencia:
🏦 Bancolombia
📋 Cuenta de Ahorros: 80498900287
👤 Esteban Bedoya

¿Cuál opción prefieres? 😊

IMPORTANTE SOBRE PAGO CONTRA ENTREGA: Si el cliente pregunta por pago contra entrega, SIEMPRE confirma que sí es posible pero aclara que el pago debe ser por transferencia bancaria en el momento de recibir, nunca en efectivo.

Después del mensaje de pago, envía SIEMPRE este mensaje de entrega EXACTAMENTE como aparece (no lo parafrasees, no escribas "mañana" ni otra fecha):

"📦 Tu pedido llegará el ${getDeliveryDate()}. Recuerda que no realizamos entregas los domingos ni días festivos."

Luego envía SIEMPRE este mensaje de despedida (adapta el nombre de la mascota con el que tengas guardado, si no tienes usa "tu peludo"):

"¡Gracias por confiar en Happy Pets Family para el cuidado de [nombre mascota] 🐾❤️ Para nosotros es un honor acompañarlos en este camino hacia una vida más sana y natural.

Si tienes alguna duda o quieres contarnos cómo está [nombre mascota], aquí estaremos siempre. ¡Hasta pronto! 😊"

INFORMACIÓN NUTRICIONAL DE LAS DIETAS BARF:
Cuando el cliente pregunte por tabla nutricional, ingredientes, información nutricional o composición de las dietas, responde con esta información (adapta el sabor si el cliente pregunta por uno específico):

🥩 Tipo de alimentación: Dieta BARF natural (Biologically Appropriate Raw Food)
✅ Sin conservantes artificiales
✅ Sin colorantes artificiales
✅ Sin químicos añadidos
✅ Ingredientes frescos con mínimo procesamiento

Fuente de proteína: varía según el sabor
🐔 Pollo | 🍎 Pollo con Frutas | 🥩 Res | 🐑 Cordero | 🐟 Pescado | 🐟 Salmón | 🐰 Conejo

Composición general:
- Proteína animal (músculo, vísceras y hueso) + verduras y/o frutas según el sabor
- Sin granos, sin rellenos, sin harinas

Beneficios principales:
🌿 Mejor digestión
💩 Menor cantidad de heces (señal de mejor aprovechamiento)
✨ Pelaje más saludable y brillante
🦷 Apoyo a la salud dental
💪 Más energía y vitalidad

Apta para: perros de todos los tamaños y edades (la cantidad varía según peso y edad del perro).

Presentación de los paquetes:
- Dieta Barf Pollo: 500gr por paquete
- Dieta Barf Gato de Ternera: 200gr por paquete
- Dieta Barf Gato de Pollo: 200gr por paquete
- Todos los demás sabores (Res, Cordero, Pescado, Salmón, Conejo, Pollo con Frutas): 400gr por paquete

NUNCA digas que no tienes información nutricional. Usa siempre los datos anteriores para responder.

⚠️ REGLA CRÍTICA — CLIENTE QUE VIENE A PAGAR UN PEDIDO EXISTENTE:
Cuando el cliente diga "vengo a pagar", "quiero pagar mi pedido", "es para hacer un pago", "ya hice un pedido" o similar:
1. Llama lookup_order para buscar sus pedidos existentes.
2. Si hay pedidos, muéstrale el resumen del más reciente:
   "Encontré tu pedido #(orderNumber):
   - (quantity) x (name): $(lineTotal) COP
   Subtotal: $(subtotal) COP
   Envío: $(shipping) COP
   Total: $(total) COP"
3. Luego envía los datos de pago (transferencia bancaria).
4. Espera que el cliente envíe el comprobante.
NUNCA crees un pedido nuevo si ya existe uno para ese cliente.

⚠️ REGLA CRÍTICA — MODIFICAR UN PEDIDO EXISTENTE:
Cuando el cliente quiera cambiar algo de un pedido que YA hizo ("quiero modificar mi pedido", "agrégame 2 de cordero", "quítame el pescado", "mejor que sean 5", "me equivoqué en el pedido"):
1. Llama lookup_order. NUNCA llames create_order en este caso: crearías un pedido duplicado.
2. CONFIRMA CON EL CLIENTE cuál pedido es, mostrándole el resumen del más reciente:
   "Encontré tu pedido #(orderNumber real):
   - (quantity) x (name): $(lineTotal) COP
   Total: $(total) COP
   ¿Es ese el que quieres modificar? 😊"
   ESPERA su respuesta. NO modifiques nada antes de que confirme.
3. Cuando confirme, pregúntale qué quiere cambiar (si aún no te lo dijo).
4. Llama update_order con orderNumber y la lista COMPLETA y FINAL de productos (los que quedan más los nuevos, no solo los que cambian).
5. SOLO DESPUÉS de que update_order retorne, muestra el resumen nuevo con los valores EXACTOS que retornó:
   ✅ Pedido actualizado #(orderNumber real)
   - (quantity) x (name): $(lineTotal real) COP
   Subtotal: $(subtotal real) COP
   Envío: $(shipping real) COP
   Total: $(total real) COP
   Si ya le enviaste los datos de pago antes, NO los repitas: solo confirma el cambio y el total nuevo.

⛔ LO QUE NO PUEDES MODIFICAR — TRANSFIERE A UN ASESOR:
Solo puedes cambiar productos y cantidades. Si el cliente pide CUALQUIER otra cosa sobre un pedido existente — cambiar la dirección, cambiar la ciudad, cancelar el pedido, cambiar la fecha de entrega, o modificar un pedido que ya pagó — NO lo intentes y NO uses ninguna herramienta. Respóndele con calidez y transfiere:
   "Claro que sí 😊 Para ese cambio te voy a pasar con un asesor del equipo que te ayuda enseguida 🐾"
   {"transfer":true,"reason":"solicitud de cambio en pedido (dirección/cancelación) que requiere asesor"}

⚠️ REGLA CRÍTICA — COMPROBANTE DE PAGO:
Cuando el cliente envíe una imagen después de hablar de pago:
1. ANALIZA la imagen con cuidado. Un comprobante de transferencia bancaria real muestra: logo del banco, número de transacción, monto transferido, fecha y cuentas involucradas.
2. Si la imagen ES un comprobante bancario real → confirma el recibo con un mensaje cálido y transfiere a asesor:
   "¡Genial! He recibido tu comprobante de transferencia 🎉
   Un asesor de nuestro equipo revisará tu comprobante y te confirmará la recepción del pago en breve. ¡Gracias por tu confianza en Happy Pets Family! 🐾"
   {"transfer":true,"reason":"comprobante de pago recibido"}
3. Si la imagen NO es un comprobante bancario (es una captura del chat, del pedido, o no se ve claramente) → pide al cliente el comprobante real:
   "Para confirmar tu pago necesito el comprobante de la transferencia desde tu app bancaria. ¿Puedes enviarlo? 😊"
NUNCA confirmes recepción de pago si la imagen no es claramente un recibo bancario.

IMPORTANTE: Al final de cada respuesta, si detectas alguna de estas situaciones, debes devolver un JSON en la última línea con el formato: {"transfer":true,"reason":"motivo"}
Situaciones que requieren transferencia a humano:
- El cliente envía un comprobante de pago, transferencia o consignación (imagen)
- El cliente expresa queja, reclamo o insatisfacción (intent: complaint)
- El cliente pide explícitamente hablar con una persona
- Hay un problema con el pedido que no puedes resolver
Si NO hay que transferir, no incluyas ese JSON.`

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt + summarySection + transferInstructions },
    ...conversationHistory.slice(-16).map((m) => ({
      role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.sender === 'human' ? `[Asesor humano]: ${m.content}` : m.content,
    })),
  ]

  // Inject known data as a late system message RIGHT before user message so it's fresh
  if (knownLines.length > 0) {
    messages.push({
      role: 'system',
      content: `⚠️ DATOS YA GUARDADOS DEL CLIENTE — NO VOLVER A PREGUNTAR:\n${knownLines.join('\n')}\n\nEstos datos ya los tienes. No los pidas de nuevo. Úsalos cuando sean relevantes para personalizar la respuesta.`,
    })
  }

  // Inject detected pending steps from the webhook (reliable state detection)
  if (pendingSteps && pendingSteps.length > 0) {
    messages.push({
      role: 'system',
      content: `⚠️ PASOS PENDIENTES DETECTADOS — DEBES COMPLETARLOS EN ESTE ORDEN ANTES DE CREAR EL PEDIDO:\n${pendingSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
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
  // Número real devuelto por la herramienta. Cualquier #WA-... del texto que no sea
  // este está inventado por el modelo.
  let realOrderNumber: string | null = null
  const calledTools = new Set<string>()

  // Handle tool calls
  const runToolLoop = async () => {
  while (response.choices[0].finish_reason === 'tool_calls') {
    const assistantMessage = response.choices[0].message
    messages.push(assistantMessage)

    type FnCall = { type: 'function'; id: string; function: { name: string; arguments: string } }
    const toolCalls = ((assistantMessage.tool_calls ?? []) as FnCall[]).filter((tc) => tc.type === 'function')
    for (const toolCall of toolCalls) {
      const args = JSON.parse(toolCall.function.arguments || '{}')
      const result = await executeTool(toolCall.function.name, args, waId, collectedProducts, roomData, pendingSteps ?? [])
      calledTools.add(toolCall.function.name)

      // Detect successful order creation
      if (toolCall.function.name === 'create_order' || toolCall.function.name === 'update_order') {
        try {
          const parsed = JSON.parse(result)
          if (parsed.success === true) {
            if (toolCall.function.name === 'create_order') orderCreated = true
            if (parsed.orderNumber) realOrderNumber = String(parsed.orderNumber)
          }
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
  }

  await runToolLoop()

  let fullText = response.choices[0].message.content ?? ''
  let forceTransfer = false

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

  // ─── Guard anti-pedido-fantasma ────────────────────────────────────────────
  // El modelo copia del historial el formato de un pedido anterior (incluido un
  // #WA-... plausible, normalmente el último +1) y lo escribe sin llamar a
  // create_order. El cliente recibe una confirmación de un pedido que no existe:
  // no está en /orders, no llega al Sheet y nadie lo despacha.
  const ORDER_ANNOUNCE = /pedido\s+(registrado|actualizado)|#\s*WA-\d+/i
  // Afirmación explícita de que el pedido quedó registrado (más estricta: citar un
  // #WA- no basta, eso también lo hacen lookup_order y el bloqueo de duplicado).
  const ORDER_CONFIRM = /pedido\s+(registrado|actualizado)/i
  // Basta con que HAYA llamado una herramienta de pedidos: si create_order fue
  // bloqueada (duplicado, falta un dato), el agente ya está en el flujo real y su
  // respuesta cita el pedido existente. Reintentar ahí duplicaba el trabajo del
  // turno más pesado y la función de Vercel se quedaba sin tiempo: el cliente no
  // recibía nada. El guard es solo para cuando no llamó NINGUNA herramienta.
  const touchedOrder =
    calledTools.has('create_order') ||
    calledTools.has('update_order') ||
    calledTools.has('lookup_order')

  if (ORDER_ANNOUNCE.test(fullText) && !touchedOrder) {
    console.error('[AGENT] PEDIDO FANTASMA: el bot anunció un pedido sin llamar ninguna herramienta. Forzando create_order.')
    messages.push({ role: 'assistant', content: fullText })
    messages.push({
      role: 'system',
      content:
        'ALTO. Acabas de escribir una confirmación de pedido SIN llamar a create_order, así que ese pedido NO EXISTE: no le llega al equipo y nadie lo despacha. El número que escribiste te lo inventaste. ' +
        'Llama AHORA a create_order con los productos, cantidades, dirección y ciudad de esta conversación. ' +
        'Si te falta algún dato obligatorio, NO inventes el pedido: pregúntaselo al cliente. ' +
        'Después de que la herramienta responda, escribe el resumen usando EXACTAMENTE el orderNumber y los totales que ella devuelva.',
    })

    response = await getOpenAI().chat.completions.create({
      model,
      temperature,
      messages,
      tools,
      tool_choice: { type: 'function', function: { name: 'create_order' } },
    })
    await runToolLoop()
    fullText = response.choices[0].message.content ?? ''

    // Segundo intento fallido: no le mandamos al cliente una confirmación falsa.
    // Solo degradamos si sigue AFIRMANDO que el pedido quedó registrado sin que
    // ninguna herramienta lo confirme. Si create_order fue bloqueada (duplicado,
    // dato faltante), su respuesta pidiendo el dato o citando el pedido existente
    // es la correcta y se envía tal cual.
    if (ORDER_CONFIRM.test(fullText) && !orderCreated && !realOrderNumber) {
      console.error('[AGENT] PEDIDO FANTASMA: el reintento tampoco creó el pedido. Se transfiere a un asesor.')
      fullText =
        'Déjame confirmarte el pedido con un asesor del equipo para no equivocarme con los datos 😊 ' +
        'En un momento te escriben para cerrarlo 🐾'
      forceTransfer = true
    }
  }

  // Si citó un número distinto al que devolvió la herramienta, se corrige.
  if (realOrderNumber) {
    fullText = fullText.replace(/WA-\d+/g, realOrderNumber)
  }

  // Only send product cards for products whose image URL the agent explicitly included
  // in its response. This lets the agent list products as plain text (no image URLs)
  // for the initial BARF presentation, and only show image cards when the client
  // selects a specific product and the agent includes that product's image URL.
  const mentionedProducts = collectedProducts.filter(p =>
    p.imageUrl && fullText.includes(p.imageUrl)
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

  if (forceTransfer) {
    transfer = true
    transferReason = 'el bot anunció un pedido que no se pudo registrar'
  }

  return { text: cleanText, transfer, transferReason, imageUrls: collectedImageUrls, products: mentionedProducts, orderCreated }
}
