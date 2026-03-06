import type { ITransferRule } from '@/types'

export function checkKeywordRules(
  message: string,
  rules: ITransferRule[]
): { triggered: boolean; ruleName?: string } {
  const lowerMessage = message.toLowerCase()

  for (const rule of rules) {
    if (!rule.active || rule.type !== 'keyword') continue
    const keywords = rule.keywords ?? []
    const matched = keywords.some((kw) => lowerMessage.includes(kw.toLowerCase()))
    if (matched) {
      return { triggered: true, ruleName: rule.name }
    }
  }

  return { triggered: false }
}

export function checkIntentRules(
  intent: string,
  rules: ITransferRule[]
): { triggered: boolean; ruleName?: string } {
  for (const rule of rules) {
    if (!rule.active || rule.type !== 'intent') continue
    if (rule.intent && rule.intent === intent) {
      return { triggered: true, ruleName: rule.name }
    }
  }
  return { triggered: false }
}

export const DEFAULT_TRANSFER_RULES: ITransferRule[] = [
  {
    id: 'rule-human-request',
    name: 'Cliente solicita asesor humano',
    type: 'keyword',
    keywords: ['asesor', 'humano', 'persona', 'agente', 'quiero hablar', 'necesito ayuda personal'],
    active: true,
  },
  {
    id: 'rule-order-confirm',
    name: 'Pedido confirmado',
    type: 'intent',
    intent: 'order_confirmed',
    active: true,
  },
  {
    id: 'rule-complaint',
    name: 'Queja o reclamo',
    type: 'intent',
    intent: 'complaint',
    active: true,
  },
]
