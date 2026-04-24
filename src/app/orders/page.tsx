'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'

type OrderStatus = 'pending' | 'paid' | 'delivered' | 'cancelled'

interface BotOrderItem {
  name: string
  price: number
  quantity: number
  lineTotal: number
}

interface BotOrder {
  _id: string
  orderNumber: string
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
  status: OrderStatus
  createdAt: string
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  paid: 'Pagado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
}

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  paid: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  delivered: 'bg-green-500/20 text-green-300 border-green-500/30',
  cancelled: 'bg-red-500/20 text-red-300 border-red-500/30',
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<BotOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function fetchOrders() {
    const res = await fetch('/api/bot-orders')
    if (res.ok) setOrders(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchOrders() }, [])

  async function handleStatusChange(id: string, status: OrderStatus) {
    setUpdating(id)
    const res = await fetch(`/api/bot-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setOrders((prev) => prev.map((o) => o._id === id ? { ...o, status } : o))
    }
    setUpdating(null)
  }

  const fmt = (n: number) => `$${n.toLocaleString('es-CO')} COP`
  const fmtDate = (d: string) =>
    new Date(d).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              📦 Pedidos
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Pedidos registrados por el bot de WhatsApp
            </p>
          </div>

          {/* Summary counters */}
          <div className="grid grid-cols-4 gap-3 mb-8">
            {(Object.keys(STATUS_LABELS) as OrderStatus[]).map((s) => {
              const count = orders.filter((o) => o.status === s).length
              return (
                <div key={s} className={`rounded-xl border p-4 ${STATUS_COLORS[s]}`}>
                  <div className="text-2xl font-bold">{count}</div>
                  <div className="text-xs mt-1 opacity-80">{STATUS_LABELS[s]}</div>
                </div>
              )
            })}
          </div>

          {loading ? (
            <div className="text-gray-500 text-sm">Cargando pedidos...</div>
          ) : orders.length === 0 ? (
            <div className="text-center text-gray-600 py-16">
              <div className="text-4xl mb-3">📦</div>
              <p>No hay pedidos registrados aún</p>
              <p className="text-sm mt-1 text-gray-700">Los pedidos confirmados por el bot aparecerán aquí</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <div key={order._id} className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                  {/* Header row */}
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-750"
                    onClick={() => setExpanded(expanded === order._id ? null : order._id)}
                  >
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="text-white font-semibold text-sm">{order.orderNumber}</div>
                        <div className="text-gray-400 text-xs mt-0.5">{fmtDate(order.createdAt)}</div>
                      </div>
                      <div>
                        <div className="text-white text-sm">{order.customerName || order.customerPhone}</div>
                        <div className="text-gray-500 text-xs">{order.customerPhone}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-white font-semibold text-sm">{fmt(order.total)}</div>
                        <div className="text-gray-500 text-xs">{order.items.length} producto{order.items.length !== 1 ? 's' : ''}</div>
                      </div>

                      {/* Status dropdown */}
                      <select
                        value={order.status}
                        disabled={updating === order._id}
                        onChange={(e) => {
                          e.stopPropagation()
                          handleStatusChange(order._id, e.target.value as OrderStatus)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg border cursor-pointer focus:outline-none disabled:opacity-50 ${STATUS_COLORS[order.status]} bg-transparent`}
                      >
                        {(Object.keys(STATUS_LABELS) as OrderStatus[]).map((s) => (
                          <option key={s} value={s} className="bg-gray-900 text-white">
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>

                      <span className="text-gray-500 text-sm">{expanded === order._id ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {expanded === order._id && (
                    <div className="border-t border-gray-700 p-4 space-y-4">
                      {/* Items */}
                      <div>
                        <div className="text-gray-400 text-xs uppercase tracking-wide mb-2">Productos</div>
                        <div className="space-y-1">
                          {order.items.map((item, i) => (
                            <div key={i} className="flex justify-between text-sm">
                              <span className="text-gray-300">{item.quantity}x {item.name}</span>
                              <span className="text-gray-400">{fmt(item.lineTotal)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="border-t border-gray-700 mt-3 pt-3 space-y-1">
                          <div className="flex justify-between text-sm text-gray-400">
                            <span>Subtotal</span><span>{fmt(order.subtotal)}</span>
                          </div>
                          <div className="flex justify-between text-sm text-gray-400">
                            <span>Envío</span><span>{fmt(order.shipping)}</span>
                          </div>
                          <div className="flex justify-between text-sm font-semibold text-white">
                            <span>Total</span><span>{fmt(order.total)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Shipping address */}
                      <div>
                        <div className="text-gray-400 text-xs uppercase tracking-wide mb-2">Dirección de entrega</div>
                        <div className="text-sm text-gray-300">
                          {order.shippingAddress.address}<br />
                          {order.shippingAddress.city}, {order.shippingAddress.department}
                          {order.shippingAddress.notes && (
                            <><br /><span className="text-gray-500 italic">Nota: {order.shippingAddress.notes}</span></>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
