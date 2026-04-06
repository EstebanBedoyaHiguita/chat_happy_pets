'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import type { ICloseReason } from '@/types'

export default function CloseReasonsPage() {
  const [reasons, setReasons] = useState<ICloseReason[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function fetchReasons() {
    const res = await fetch('/api/config/close-reasons')
    if (res.ok) setReasons(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchReasons() }, [])

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    await fetch('/api/config/close-reasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    setName('')
    setShowForm(false)
    setSaving(false)
    fetchReasons()
  }

  async function handleToggle(id: string, active: boolean) {
    await fetch(`/api/config/close-reasons/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    })
    setReasons((prev) => prev.map((r) => (r._id === id ? { ...r, active } : r)))
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este motivo de cierre?')) return
    await fetch(`/api/config/close-reasons/${id}`, { method: 'DELETE' })
    setReasons((prev) => prev.filter((r) => r._id !== id))
  }

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                🔴 Motivos de cierre
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                Define los motivos disponibles al cerrar una conversación manualmente.
              </p>
            </div>
            <button
              onClick={() => setShowForm(!showForm)}
              className="bg-green-600 hover:bg-green-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              + Nuevo motivo
            </button>
          </div>

          {showForm && (
            <form
              onSubmit={handleAdd}
              className="bg-gray-800 border border-gray-700 rounded-xl p-5 mb-6 space-y-4"
            >
              <h3 className="text-white font-medium">Nuevo motivo de cierre</h3>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Nombre</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="Ej: Pedido realizado"
                  autoFocus
                  required
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg"
                >
                  {saving ? 'Guardando...' : 'Agregar'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setName('') }}
                  className="text-gray-400 hover:text-white text-sm px-4 py-2 rounded-lg"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="text-gray-500 text-sm">Cargando...</div>
          ) : reasons.length === 0 ? (
            <div className="text-center text-gray-600 py-16">
              <div className="text-4xl mb-3">🔴</div>
              <p>No hay motivos de cierre configurados</p>
              <p className="text-sm mt-1">Crea al menos uno para poder cerrar conversaciones manualmente</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reasons.map((r) => (
                <div
                  key={r._id}
                  className={`bg-gray-800 border rounded-xl p-4 flex items-center justify-between transition-colors ${
                    r.active ? 'border-gray-700' : 'border-gray-800 opacity-50'
                  }`}
                >
                  <span className="text-white text-sm font-medium">{r.name}</span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleToggle(r._id, !r.active)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${
                        r.active ? 'bg-green-600' : 'bg-gray-600'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          r.active ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                    <button
                      onClick={() => handleDelete(r._id)}
                      className="text-gray-500 hover:text-red-400 transition-colors text-lg"
                      title="Eliminar"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
