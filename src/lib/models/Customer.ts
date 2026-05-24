import mongoose, { Schema, Document } from 'mongoose'

export interface ICustomer extends Document {
  type: 'people'
  waId: string
  name: string
  phone: string
  address: string
  petName: string
  petType: string
  petAge: string
  petWeight: string
  pet2Name: string
  pet2Type: string
  pet2Age: string
  pet2Weight: string
  pet3Name: string
  pet3Type: string
  pet3Age: string
  pet3Weight: string
  adSource?: string
  adId?: string
  adTitle?: string
  adBody?: string
  ctwaClid?: string
  sourceUrl?: string
  createdAt: Date
  updatedAt: Date
}

const CustomerSchema = new Schema<ICustomer>(
  {
    type: { type: String, default: 'people' },
    waId: { type: String, required: true, unique: true },
    name: { type: String, default: '' },
    phone: { type: String, default: '' },
    address: { type: String, default: '' },
    petName: { type: String, default: '' },
    petType: { type: String, default: '' },
    petAge: { type: String, default: '' },
    petWeight: { type: String, default: '' },
    pet2Name: { type: String, default: '' },
    pet2Type: { type: String, default: '' },
    pet2Age: { type: String, default: '' },
    pet2Weight: { type: String, default: '' },
    pet3Name: { type: String, default: '' },
    pet3Type: { type: String, default: '' },
    pet3Age: { type: String, default: '' },
    pet3Weight: { type: String, default: '' },
    adSource: { type: String },
    adId: { type: String },
    adTitle: { type: String },
    adBody: { type: String },
    ctwaClid: { type: String },
    sourceUrl: { type: String },
  },
  { timestamps: true }
)

export const Customer =
  mongoose.models.Customer || mongoose.model<ICustomer>('Customer', CustomerSchema)
