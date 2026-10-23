import mongoose, { Schema, Document } from 'mongoose'

export interface BotOrderItem {
  name: string
  price: number
  quantity: number
  lineTotal: number
  image?: string
}

/** Estado del pedido ANTES de una edición, apilado por update_order para auditoría. */
export interface BotOrderEdit {
  editedAt: Date
  editedBy: string
  previousItems: BotOrderItem[]
  previousSubtotal: number
  previousTotal: number
  reason?: string
}

/**
 * Aviso al agente de pedidos del proveedor (ver supplier-dispatch.ts).
 * queued → sent → confirmed, o review cuando algo no cuadra y debe verlo un humano.
 */
export type SupplierStatus = 'queued' | 'sent' | 'confirmed' | 'review'

export interface BotOrderSupplier {
  status: SupplierStatus
  queuedAt?: Date
  sentAt?: Date
  confirmedAt?: Date
  supplierOrderNumber?: string
  note?: string
  /** Ya se le mandó como texto: su bot no lee plantillas (ver supplier-dispatch.ts). */
  textSent?: boolean
}

export interface BotOrderDoc extends Document {
  orderNumber: string
  waId: string
  customerName: string
  customerPhone: string
  items: BotOrderItem[]
  subtotal: number
  shipping: number
  total: number
  shippingAddress: {
    address: string
    city: string
    department: string
    notes?: string
  }
  status: 'pending' | 'delivered' | 'cancelled'
  paid: boolean
  editHistory: BotOrderEdit[]
  supplier?: BotOrderSupplier
  createdAt: Date
}

const SupplierSchema = new Schema<BotOrderSupplier>(
  {
    status: { type: String, enum: ['queued', 'sent', 'confirmed', 'review'], required: true },
    queuedAt: { type: Date },
    sentAt: { type: Date },
    confirmedAt: { type: Date },
    supplierOrderNumber: { type: String },
    note: { type: String },
    textSent: { type: Boolean },
  },
  { _id: false }
)

const BotOrderSchema = new Schema<BotOrderDoc>(
  {
    orderNumber: { type: String, required: true, unique: true },
    waId: { type: String, required: true },
    customerName: { type: String, default: '' },
    customerPhone: { type: String, default: '' },
    items: [
      {
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, required: true },
        lineTotal: { type: Number, required: true },
        image: { type: String, default: '' },
      },
    ],
    subtotal: { type: Number, required: true },
    shipping: { type: Number, required: true },
    total: { type: Number, required: true },
    shippingAddress: {
      address: { type: String, required: true },
      city: { type: String, required: true },
      department: { type: String, default: '' },
      notes: { type: String, default: '' },
    },
    status: {
      type: String,
      enum: ['pending', 'delivered', 'cancelled'],
      default: 'pending',
    },
    paid: { type: Boolean, default: false },
    editHistory: {
      type: [
        {
          editedAt: { type: Date, default: Date.now },
          editedBy: { type: String, default: 'Bot' },
          previousItems: [
            {
              name: { type: String, required: true },
              price: { type: Number, required: true },
              quantity: { type: Number, required: true },
              lineTotal: { type: Number, required: true },
              image: { type: String, default: '' },
            },
          ],
          previousSubtotal: { type: Number, required: true },
          previousTotal: { type: Number, required: true },
          reason: { type: String, default: '' },
          _id: false,
        },
      ],
      default: [],
    },
    supplier: { type: SupplierSchema, default: undefined },
  },
  { timestamps: true }
)

export const BotOrder =
  mongoose.models.BotOrder ||
  mongoose.model<BotOrderDoc>('BotOrder', BotOrderSchema)
