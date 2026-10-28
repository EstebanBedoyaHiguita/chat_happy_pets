const BASE_URL = process.env.HAPPY_PETS_API_URL

/**
 * El backend está en Render y se duerme: el primer request tardaba hasta ~37 s y el
 * cliente esperaba todo ese tiempo (auditoría 2026-10-26). Con un tiempo máximo, quien
 * llama decide qué hacer: el catálogo cae a Mongo (product-display.ts).
 */
const DEFAULT_TIMEOUT_MS = 15_000

async function fetchHP(path: string, options?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Happy Pets API error ${res.status}: ${text}`)
  }
  return res.json()
}

export async function getProducts(category?: string, timeoutMs?: number) {
  const qs = category ? `?category=${category}` : ''
  return fetchHP(`/api/products${qs}`, undefined, timeoutMs)
}

export async function getFeaturedProducts() {
  return fetchHP('/api/products/featured')
}

export async function getCategories() {
  return fetchHP('/api/categories')
}

export async function getProductDetail(productId: string) {
  return fetchHP(`/api/products/${productId}`)
}

export async function createOrder(orderData: unknown) {
  return fetchHP('/api/orders', {
    method: 'POST',
    body: JSON.stringify(orderData),
  })
}

export async function getCities() {
  return fetchHP('/api/cities')
}

export async function getShippingCost(cityId: string) {
  return fetchHP(`/api/cities/${cityId}/shipping-cost`)
}

export async function registerCustomer(data: {
  name: string
  email: string
  password: string
  phone?: string
}) {
  return fetchHP('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
