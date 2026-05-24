'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'

interface LeadStatus {
  _id: string
  name: string
  color: string
  active: boolean
  order: number
}

const PRESET_COLORS = [
  '#6b7280', // gray
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // yellow
  '#f97316', // orange
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
]

export default function LeadStatusesPage() {
  const [statuses, setStatuses] = useState<LeadStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#10b981')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

  async function fetchStatuses() {
    const res = await fetch('/api/config/lead-statuses')
    if (res.ok) setStatuses(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchStatuses() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim() || saving) return
    setSaving(true)
    const res = await fetch('/api/config/lead-statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), color: newColor }),
    })
    if (res.ok) {
      setNewName('')
      await fetchStatuses()
    }
    setSaving(false)
  }

  function startEdit(s: LeadStatus) {
    setEditingId(s._id)
    setEditName(s.name)
    setEditColor(s.color)
  }

  async function handleSaveEdit(id: string) {
    await fetch(`/api/config/lead-statuses/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim(), color: editColor }),
    })
    setEditingId(null)
    await fetchStatuses()
  }

  async function handleToggleActive(s: LeadStatus) {
    await fetch(`/api/config/lead-statuses/${s._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !s.active }),
    })
    await fetchStatuses()
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este estado?')) return
    await fetch(`/api/config/lead-statuses/${id}`, { method: 'DELETE' })
    await fetchStatuses()
  }

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-white text-2xl font-semibold mb-1">Estados de lead</h1>
          <p className="text-gray-400 text-sm mb-8">
            Define los estados que puedes asignar a cada contacto para hacer seguimiento del ciclo de venta.
          </p>

          {/* Create form */}
          <form onSubmit={handleCreate} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
            <h2 className="text-white font-medium text-sm mb-4">Nuevo estado</h2>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-gray-400 text-xs mb-1 block">Nombre</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ej: Nuevo lead, En seguimiento, Cliente activo..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Color</label>
                <div className="flex gap-1.5 flex-wrap w-48">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewColor(c)}
                      className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                      style={{ backgroundColor: c, borderColor: newColor === c ? 'white' : 'transparent' }}
                    />
                  ))}
                </div>
              </div>
              <button
                type="submit"
                disabled={saving || !newName.trim()}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
              >
                {saving ? 'Guardando...' : '+ Agregar'}
              </button>
            </div>
          </form>

          {/* List */}
          {loading ? (
            <p className="text-gray-500 text-sm">Cargando...</p>
          ) : statuses.length === 0 ? (
            <p className="text-gray-500 text-sm">No hay estados creados todavía.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {statuses.map((s) => (
                <div
                  key={s._id}
                  className={`bg-gray-900 border rounded-xl p-4 flex items-center gap-3 transition-opacity ${!s.active ? 'opacity-50' : ''} border-gray-800`}
                >
                  {editingId === s._id ? (
                    <>
                      <div className="flex gap-1.5 flex-wrap">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setEditColor(c)}
                            className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                            style={{ backgroundColor: c, borderColor: editColor === c ? 'white' : 'transparent' }}
                          />
                        ))}
                      </div>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(s._id) }}
                        autoFocus
                      />
                      <button onClick={() => handleSaveEdit(s._id)} className="text-green-400 text-xs hover:text-green-300 font-medium">Guardar</button>
                      <button onClick={() => setEditingId(null)} className="text-gray-500 text-xs hover:text-white">Cancelar</button>
                    </>
                  ) : (
                    <>
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="flex-1 text-white text-sm">{s.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${s.active ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                        {s.active ? 'Activo' : 'Inactivo'}
                      </span>
                      <button onClick={() => startEdit(s)} className="text-gray-400 hover:text-white text-xs transition-colors">Editar</button>
                      <button onClick={() => handleToggleActive(s)} className="text-gray-400 hover:text-white text-xs transition-colors">
                        {s.active ? 'Desactivar' : 'Activar'}
                      </button>
                      <button onClick={() => handleDelete(s._id)} className="text-red-500 hover:text-red-400 text-xs transition-colors">Eliminar</button>
                    </>
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
