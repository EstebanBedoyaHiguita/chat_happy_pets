'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'

export default function KnowledgePage() {
  const [systemPrompt, setSystemPrompt] = useState('')
  const [model, setModel] = useState('gpt-4o')
  const [temperature, setTemperature] = useState(0.7)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((data) => {
        setSystemPrompt(data.systemPrompt ?? '')
        setModel(data.aiModel ?? 'gpt-4o')
        setTemperature(data.temperature ?? 0.7)
        setLoading(false)
      })
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)

    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemPrompt, aiModel: model, temperature }),
    })

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              🧠 Base de conocimiento
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Define el comportamiento y personalidad del agente IA. Aquí puedes incluir información del negocio, productos, políticas, etc.
            </p>
          </div>

          {loading ? (
            <div className="text-gray-500 text-sm">Cargando configuración...</div>
          ) : (
            <form onSubmit={handleSave} className="space-y-6">
              {/* System Prompt */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Instrucciones del agente (System Prompt)
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={20}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500 font-mono resize-y"
                  placeholder="Eres un asistente de Happy Pets..."
                />
                <p className="text-xs text-gray-500 mt-1">
                  Puedes incluir información del negocio, productos, políticas de envío, precios, horarios, etc.
                </p>
              </div>

              {/* Model Config */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Modelo IA
                  </label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
                  >
                    <option value="gpt-4o">GPT-4o (Recomendado)</option>
                    <option value="gpt-4o-mini">GPT-4o Mini (Más rápido)</option>
                    <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Temperatura: <span className="text-green-400">{temperature}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="w-full accent-green-500"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Preciso (0)</span>
                    <span>Creativo (1)</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-green-600 hover:bg-green-500 disabled:bg-green-900 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors"
                >
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </button>
                {saved && (
                  <span className="text-green-400 text-sm flex items-center gap-1">
                    ✓ Guardado correctamente
                  </span>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
