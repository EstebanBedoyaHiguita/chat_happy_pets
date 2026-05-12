'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'

type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
type TemplateStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED'

interface Template {
  _id: string
  name: string
  displayName: string
  category: TemplateCategory
  language: string
  bodyText: string
  variables: string[]
  metaStatus: TemplateStatus
  createdAt: string
}

const STATUS_COLORS: Record<TemplateStatus, string> = {
  APPROVED: 'bg-green-500/20 text-green-300 border-green-500/30',
  PENDING: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  REJECTED: 'bg-red-500/20 text-red-300 border-red-500/30',
  PAUSED: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  DISABLED: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  UTILITY: 'Utilitaria',
  MARKETING: 'Marketing',
  AUTHENTICATION: 'Autenticación',
}

function extractVariables(text: string): string[] {
  const matches = text.match(/\{\{(\d+)\}\}/g) ?? []
  const nums = new Set(matches.map((m) => parseInt(m.replace(/[{}]/g, ''), 10)).filter((n) => !isNaN(n)))
  return Array.from(nums).sort((a, b) => a - b).map((n) => `Variable ${n}`)
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const [form, setForm] = useState({
    displayName: '',
    category: 'UTILITY' as TemplateCategory,
    language: 'es',
    bodyText: '',
  })
  const [varExamples, setVarExamples] = useState<string[]>([])

  async function fetchTemplates() {
    const res = await fetch('/api/templates')
    if (res.ok) setTemplates(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchTemplates() }, [])

  const previewVars = extractVariables(form.bodyText)

  // Keep varExamples in sync with detected variable count
  function handleBodyTextChange(text: string) {
    const vars = extractVariables(text)
    setVarExamples((prev) => {
      const next = Array(vars.length).fill('')
      prev.forEach((v, i) => { if (i < next.length) next[i] = v })
      return next
    })
    setForm({ ...form, bodyText: text })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setError('')
    setSaving(true)
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, variables: previewVars, variableExamples: varExamples }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Error al crear la plantilla')
    } else {
      setTemplates((prev) => [data, ...prev])
      setForm({ displayName: '', category: 'UTILITY', language: 'es', bodyText: '' })
      setVarExamples([])
      setShowForm(false)
    }
    setSaving(false)
  }

  async function handleSync(id: string) {
    setSyncing(id)
    const res = await fetch(`/api/templates/${id}`, { method: 'POST' })
    if (res.ok) {
      const updated = await res.json()
      setTemplates((prev) => prev.map((t) => t._id === id ? updated : t))
    }
    setSyncing(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta plantilla? También se eliminará de Meta.')) return
    setDeleting(id)
    await fetch(`/api/templates/${id}`, { method: 'DELETE' })
    setTemplates((prev) => prev.filter((t) => t._id !== id))
    setDeleting(null)
  }

  const previewText = form.bodyText.replace(/\{\{(\d+)\}\}/g, (_, n) => `[Variable ${n}]`)

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">📋 Plantillas de WhatsApp</h1>
              <p className="text-gray-400 text-sm mt-1">Crea y gestiona plantillas aprobadas por Meta para retomar conversaciones</p>
            </div>
            <button
              onClick={() => { setShowForm(!showForm); setError('') }}
              className="bg-green-600 hover:bg-green-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {showForm ? 'Cancelar' : '+ Nueva plantilla'}
            </button>
          </div>

          {/* Create form */}
          {showForm && (
            <form onSubmit={handleCreate} className="bg-gray-800 border border-gray-700 rounded-xl p-6 mb-6 space-y-4">
              <h2 className="text-white font-semibold text-sm">Nueva plantilla</h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Nombre para mostrar</label>
                  <input
                    value={form.displayName}
                    onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                    placeholder="Ej: Retomar con cliente"
                    required
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                  {form.displayName && (
                    <p className="text-gray-600 text-xs mt-1">
                      Nombre en Meta: <span className="text-gray-400">{form.displayName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 60)}</span>
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Categoría</label>
                    <select
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value as TemplateCategory })}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
                    >
                      <option value="UTILITY">Utilitaria</option>
                      <option value="MARKETING">Marketing</option>
                      <option value="AUTHENTICATION">Autenticación</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Idioma</label>
                    <select
                      value={form.language}
                      onChange={(e) => setForm({ ...form, language: e.target.value })}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
                    >
                      <option value="es">Español (es)</option>
                      <option value="es_CO">Español Colombia (es_CO)</option>
                      <option value="en_US">Inglés (en_US)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-gray-400 text-xs mb-1 block">
                  Texto del cuerpo — usa {`{{1}}`}, {`{{2}}`}... para variables
                </label>
                <textarea
                  value={form.bodyText}
                  onChange={(e) => handleBodyTextChange(e.target.value)}
                  placeholder={`Hola {{1}}, hace un tiempo no sabemos de ti. ¿Cómo está {{2}}? ¿Te gustaría continuar con el pedido de alimento BARF? 🐾`}
                  rows={4}
                  required
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-green-500 resize-none"
                />
              </div>

              {previewVars.length > 0 && (
                <div className="bg-gray-900 rounded-lg p-3 space-y-3">
                  <div>
                    <p className="text-gray-400 text-xs mb-2">Valores de ejemplo para Meta <span className="text-red-400">*</span> — Meta los revisa para aprobar la plantilla:</p>
                    {previewVars.map((_, i) => (
                      <div key={i} className="flex items-center gap-2 mb-2">
                        <span className="text-blue-400 text-xs font-mono w-10 flex-shrink-0">{`{{${i + 1}}}`}</span>
                        <input
                          value={varExamples[i] ?? ''}
                          onChange={(e) => {
                            const next = [...varExamples]
                            next[i] = e.target.value
                            setVarExamples(next)
                          }}
                          placeholder={`Ej: ${i === 0 ? 'Juan' : i === 1 ? 'Firulais' : `valor ${i + 1}`}`}
                          required
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-gray-500 text-xs">Vista previa: <span className="text-gray-300">{previewText}</span></p>
                </div>
              )}

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white text-sm transition-colors">Cancelar</button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
                >
                  {saving ? 'Creando en Meta...' : 'Crear plantilla'}
                </button>
              </div>
            </form>
          )}

          {/* Template list */}
          {loading ? (
            <p className="text-gray-500 text-sm">Cargando plantillas...</p>
          ) : templates.length === 0 ? (
            <div className="text-center text-gray-600 py-16">
              <div className="text-4xl mb-3">📋</div>
              <p>No hay plantillas creadas aún</p>
              <p className="text-sm mt-1 text-gray-700">Las plantillas aprobadas aparecen en el modal de &quot;Retomar conversación&quot;</p>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((t) => (
                <div key={t._id} className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-semibold text-sm">{t.displayName}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLORS[t.metaStatus]}`}>
                          {t.metaStatus}
                        </span>
                        <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded-full">{CATEGORY_LABELS[t.category]}</span>
                        <span className="text-xs text-gray-600 font-mono">{t.name}</span>
                      </div>
                      <p className="text-gray-400 text-sm mt-2 whitespace-pre-wrap">{t.bodyText}</p>
                      {t.variables.length > 0 && (
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {t.variables.map((v, i) => (
                            <span key={i} className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">{`{{${i + 1}}}`}: {v}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleSync(t._id)}
                        disabled={syncing === t._id}
                        title="Sincronizar estado con Meta"
                        className="text-xs text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {syncing === t._id ? '...' : '↻ Sync'}
                      </button>
                      <button
                        onClick={() => handleDelete(t._id)}
                        disabled={deleting === t._id}
                        className="text-xs text-red-400 hover:text-white bg-red-500/10 hover:bg-red-500/20 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {deleting === t._id ? '...' : 'Eliminar'}
                      </button>
                    </div>
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
