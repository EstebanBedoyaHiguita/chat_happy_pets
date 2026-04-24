import mongoose, { Schema, Document } from 'mongoose'

export interface BotOrderItem {
  name: string
  price: number
  quantity: number
  lineTotal: number
  image?: string
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
  createdAt: Date
}

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
      department: { type: String, required: true },
      notes: { type: String, default: '' },
    },
    status: {
      type: String,
      enum: ['pending', 'delivered', 'cancelled'],
      default: 'pending',
    },
    paid: { type: Boolean, default: false },
  },
  { timestamps: true }
)

export const BotOrder =
  mongoose.models.BotOrder ||
  mongoose.model<BotOrderDoc>('BotOrder', BotOrderSchema)
