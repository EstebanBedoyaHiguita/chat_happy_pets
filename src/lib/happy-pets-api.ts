const BASE_URL = process.env.HAPPY_PETS_API_URL

async function fetchHP(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    next: { revalidate: 0 },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Happy Pets API error ${res.status}: ${text}`)
  }
  return res.json()
}

export async function getProducts(category?: string) {
  const qs = category ? `?category=${category}` : ''
  return fetchHP(`/api/products${qs}`)
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
