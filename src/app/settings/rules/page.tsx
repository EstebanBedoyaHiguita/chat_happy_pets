'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import type { ITransferRule, TransferRuleType } from '@/types'

const RULE_TYPE_LABELS: Record<TransferRuleType, string> = {
  keyword: 'Palabra clave',
  intent: 'Intención detectada',
}

const INTENT_EXAMPLES = [
  'order_confirmed',
  'complaint',
  'payment_request',
  'urgent',
]

function RuleCard({
  rule,
  onToggle,
  onDelete,
}: {
  rule: ITransferRule
  onToggle: (id: string, active: boolean) => void
  onDelete: (id: string) => void
}) {
  return (
    <div
      className={`bg-gray-800 border rounded-xl p-4 transition-colors ${
        rule.active ? 'border-gray-700' : 'border-gray-800 opacity-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white font-medium text-sm">{rule.name}</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                rule.type === 'keyword'
                  ? 'bg-yellow-900/50 text-yellow-300 border border-yellow-700'
                  : 'bg-purple-900/50 text-purple-300 border border-purple-700'
              }`}
            >
              {RULE_TYPE_LABELS[rule.type]}
            </span>
          </div>

          {rule.type === 'keyword' && rule.keywords && (
            <div className="flex flex-wrap gap-1 mt-2">
              {rule.keywords.map((kw) => (
                <span
                  key={kw}
                  className="bg-gray-700 text-gray-300 text-xs px-2 py-0.5 rounded-md"
                >
                  {kw}
                </span>
              ))}
            </div>
          )}

          {rule.type === 'intent' && rule.intent && (
            <span className="text-xs text-purple-300 bg-purple-900/30 px-2 py-0.5 rounded-md mt-1 inline-block">
              intent: {rule.intent}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onToggle(rule.id, !rule.active)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              rule.active ? 'bg-green-600' : 'bg-gray-600'
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                rule.active ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>

          <button
            onClick={() => onDelete(rule.id)}
            className="text-gray-500 hover:text-red-400 transition-colors text-lg"
            title="Eliminar regla"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}

const EMPTY_FORM = {
  name: '',
  type: 'keyword' as TransferRuleType,
  keywords: '',
  intent: '',
}

export default function RulesPage() {
  const [rules, setRules] = useState<ITransferRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  async function fetchRules() {
    const res = await fetch('/api/config/rules')
    if (res.ok) {
      setRules(await res.json())
    }
    setLoading(false)
  }

  useEffect(() => { fetchRules() }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    const rule: Partial<ITransferRule> = {
      name: form.name,
      type: form.type,
      active: true,
    }

    if (form.type === 'keyword') {
      rule.keywords = form.keywords.split(',').map((k) => k.trim()).filter(Boolean)
    } else {
      rule.intent = form.intent.trim()
    }

    await fetch('/api/config/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    })

    setForm(EMPTY_FORM)
    setShowForm(false)
    setSaving(false)
    fetchRules()
  }

  async function handleToggle(id: string, active: boolean) {
    await fetch('/api/config/rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active }),
    })
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, active } : r)))
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta regla?')) return
    await fetch('/api/config/rules', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                ⚡ Reglas de transferencia
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                Define cuándo el bot debe escalar una conversación a un asesor humano.
              </p>
            </div>

            <button
              onClick={() => setShowForm(!showForm)}
              className="bg-green-600 hover:bg-green-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              + Nueva regla
            </button>
          </div>

          {/* Add rule form */}
          {showForm && (
            <form
              onSubmit={handleAdd}
              className="bg-gray-800 border border-gray-700 rounded-xl p-5 mb-6 space-y-4"
            >
              <h3 className="text-white font-medium">Nueva regla de transferencia</h3>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Nombre de la regla</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="Ej: Cliente solicita hablar con alguien"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Tipo de regla</label>
                <div className="flex gap-2">
                  {(['keyword', 'intent'] as TransferRuleType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm({ ...form, type: t })}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        form.type === t
                          ? 'bg-green-700 border-green-600 text-white'
                          : 'bg-gray-700 border-gray-600 text-gray-400 hover:text-white'
                      }`}
                    >
                      {RULE_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {form.type === 'keyword' && (
                <div>
                  <label className="block text-sm text-gray-300 mb-1">
                    Palabras clave <span className="text-gray-500">(separadas por coma)</span>
                  </label>
                  <input
                    type="text"
                    value={form.keywords}
                    onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
                    placeholder="asesor, humano, persona, quiero hablar"
                    required
                  />
                </div>
              )}

              {form.type === 'intent' && (
                <div>
                  <label className="block text-sm text-gray-300 mb-1">
                    Intención (intent)
                  </label>
                  <input
                    type="text"
                    value={form.intent}
                    onChange={(e) => setForm({ ...form, intent: e.target.value })}
                    list="intent-examples"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
                    placeholder="order_confirmed"
                    required
                  />
                  <datalist id="intent-examples">
                    {INTENT_EXAMPLES.map((ex) => <option key={ex} value={ex} />)}
                  </datalist>
                  <p className="text-xs text-gray-500 mt-1">
                    El agente IA detecta esta intención y devuelve la señal de transferencia automáticamente.
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg"
                >
                  {saving ? 'Guardando...' : 'Agregar regla'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }}
                  className="text-gray-400 hover:text-white text-sm px-4 py-2 rounded-lg"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {/* Rules list */}
          {loading ? (
            <div className="text-gray-500 text-sm">Cargando reglas...</div>
          ) : rules.length === 0 ? (
            <div className="text-center text-gray-600 py-16">
              <div className="text-4xl mb-3">⚡</div>
              <p>No hay reglas configuradas</p>
              <p className="text-sm mt-1">Crea una regla para escalar conversaciones automáticamente</p>
            </div>
          ) : (
            <div className="space-y-3">
              {rules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
