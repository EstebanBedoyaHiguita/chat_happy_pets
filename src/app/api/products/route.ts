import { NextResponse } from 'next/server'
import { getProducts } from '@/lib/happy-pets-api'

export async function GET() {
  const raw = await getProducts()
  const list: { _id: string; name: string; price: number }[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown[] })?.data)
      ? (raw as { data: { _id: string; name: string; price: number }[] }).data
      : []
  return NextResponse.json(list.map(p => ({ _id: p._id, name: p.name, price: p.price })))
}
