'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'

type OrderStatus = 'pending' | 'delivered' | 'cancelled'

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
  paid: boolean
  createdAt: string
}

interface ManualItem {
  name: string
  quantity: number
  price: number
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
}

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  delivered: 'bg-green-500/20 text-green-300 border-green-500/30',
  cancelled: 'bg-red-500/20 text-red-300 border-red-500/30',
}

const EMPTY_FORM = {
  customerName: '',
  customerPhone: '',
  address: '',
  city: '',
  department: '',
  notes: '',
  shipping: '0',
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<BotOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [manualItems, setManualItems] = useState<ManualItem[]>([{ name: '', quantity: 1, price: 0 }])
  const [saving, setSaving] = useState(false)

  async function fetchOrders() {
    const res = await fetch('/api/bot-orders')
    if (res.ok) setOrders(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchOrders() }, [])

  function updateItem(i: number, field: keyof ManualItem, value: string) {
    setManualItems(prev => prev.map((item, idx) =>
      idx === i ? { ...item, [field]: field === 'name' ? value : Number(value) } : item
    ))
  }

  function addItem() {
    setManualItems(prev => [...prev, { name: '', quantity: 1, price: 0 }])
  }

  function removeItem(i: number) {
    setManualItems(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handleCreateManual(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    const res = await fetch('/api/bot-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        shipping: Number(form.shipping),
        items: manualItems.filter(i => i.name.trim()),
      }),
    })
    if (res.ok) {
      setShowModal(false)
      setForm(EMPTY_FORM)
      setManualItems([{ name: '', quantity: 1, price: 0 }])
      await fetchOrders()
    }
    setSaving(false)
  }

  async function handlePatch(id: string, patch: { status?: OrderStatus; paid?: boolean }) {
    setUpdating(id)
    const res = await fetch(`/api/bot-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (res.ok) {
      setOrders((prev) => prev.map((o) => o._id === id ? { ...o, ...patch } : o))
    }
    setUpdating(null)
  }

  const fmt = (n: number) => `$${n.toLocaleString('es-CO')} COP`
  const fmtDate = (d: string) =>
    new Date(d).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <>
    <div className="flex h-screen bg-gray-950">
      <Sidebar />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8">
          <div className="mb-8 flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                📦 Pedidos
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                Pedidos registrados por el bot de WhatsApp
              </p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              + Nuevo pedido
            </button>
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
            <div className="rounded-xl border p-4 bg-blue-500/20 text-blue-300 border-blue-500/30">
              <div className="text-2xl font-bold">{orders.filter((o) => o.paid).length}</div>
              <div className="text-xs mt-1 opacity-80">Pagados</div>
            </div>
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
                    className="flex items-center justify-between p-4 cursor-pointer"
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

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-white font-semibold text-sm">{fmt(order.total)}</div>
                        <div className="text-gray-500 text-xs">{order.items.length} producto{order.items.length !== 1 ? 's' : ''}</div>
                      </div>

                      {/* Paid toggle */}
                      <button
                        disabled={updating === order._id}
                        onClick={(e) => {
                          e.stopPropagation()
                          handlePatch(order._id, { paid: !order.paid })
                        }}
                        title={order.paid ? 'Marcar como no pagado' : 'Marcar como pagado'}
                        className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                          order.paid
                            ? 'bg-blue-500/20 text-blue-300 border-blue-500/30 hover:bg-blue-500/30'
                            : 'bg-gray-700 text-gray-400 border-gray-600 hover:bg-gray-600 hover:text-white'
                        }`}
                      >
                        <span>{order.paid ? '✓' : '○'}</span>
                        <span>Pagado</span>
                      </button>

                      {/* Status dropdown */}
                      <select
                        value={order.status}
                        disabled={updating === order._id}
                        onChange={(e) => {
                          e.stopPropagation()
                          handlePatch(order._id, { status: e.target.value as OrderStatus })
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

      {/* Manual order modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-white font-semibold text-lg">Nuevo pedido manual</h2>
                <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-white text-xl">✕</button>
              </div>

              <form onSubmit={handleCreateManual} className="space-y-4">
                {/* Customer */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Nombre cliente *</label>
                    <input required value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Teléfono</label>
                    <input value={form.customerPhone} onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500" />
                  </div>
                </div>

                {/* Items */}
                <div>
                  <label className="text-gray-400 text-xs mb-2 block">Productos *</label>
                  <div className="space-y-2">
                    {manualItems.map((item, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input placeholder="Nombre producto" value={item.name} onChange={e => updateItem(i, 'name', e.target.value)}
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500" />
                        <input type="number" min={1} placeholder="Cant" value={item.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)}
                          className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500" />
                        <input type="number" min={0} placeholder="Precio" value={item.price || ''} onChange={e => updateItem(i, 'price', e.target.value)}
                          className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500" />
                        {manualItems.length > 1 && (
                          <button type="button" onClick={() => removeItem(i)} className="text-red-500 hover:text-red-400 text-sm px-1">✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={addItem} className="mt-2 text-green-400 hover:text-green-300 text-xs">+ Agregar producto</button>
                </div>

                {/* Address */}
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Dirección *</label>
                  <input required value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Ciudad *</label>
                    <input required value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Costo de envío</label>
                    <input type="number" min={0} value={form.shipping} onChange={e => setForm(f => ({ ...f, shipping: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500" />
                  </div>
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Notas adicionales</label>
                  <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500" />
                </div>

                {/* Total preview */}
                <div className="bg-gray-800 rounded-lg p-3 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>Subtotal</span>
                    <span>{fmt(manualItems.reduce((s, i) => s + i.price * i.quantity, 0))}</span>
                  </div>
                  <div className="flex justify-between text-gray-400 mt-1">
                    <span>Envío</span>
                    <span>{fmt(Number(form.shipping))}</span>
                  </div>
                  <div className="flex justify-between text-white font-semibold mt-2 pt-2 border-t border-gray-700">
                    <span>Total</span>
                    <span>{fmt(manualItems.reduce((s, i) => s + i.price * i.quantity, 0) + Number(form.shipping))}</span>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)}
                    className="flex-1 py-2 border border-gray-700 text-gray-400 hover:text-white rounded-lg text-sm transition-colors">
                    Cancelar
                  </button>
                  <button type="submit" disabled={saving}
                    className="flex-1 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors">
                    {saving ? 'Guardando...' : 'Crear pedido'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
