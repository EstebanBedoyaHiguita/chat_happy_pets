import { NextResponse } from 'next/server'
import { getProducts } from '@/lib/happy-pets-api'

export async function GET() {
  try {
    const raw = await getProducts()
    // Handle all possible response shapes
    let list: { _id: string; name: string; price: number }[] = []
    if (Array.isArray(raw)) list = raw
    else if (Array.isArray(raw?.data)) list = raw.data
    else if (Array.isArray(raw?.products)) list = raw.products
    else if (Array.isArray(raw?.items)) list = raw.items
    return NextResponse.json(list.map((p: { _id: string; name: string; price: number }) => ({ _id: p._id, name: p.name, price: p.price })))
  } catch (err) {
    console.error('[/api/products]', err)
    // El motivo viaja al panel: sin esto el selector de productos se quedaba vacío
    // sin explicar por qué y no se podían crear pedidos manuales.
    return NextResponse.json(
      {
        error: 'No se pudo cargar el catálogo',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}
