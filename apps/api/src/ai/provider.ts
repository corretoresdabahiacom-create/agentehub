import type { Bindings } from '../env';

/**
 * Camada de IA (briefing §7). A plataforma funciona SEM IA: nenhum provedor vem ligado por padrão,
 * não há chave embutida, e um passo que exige IA é recusado com `ai_not_configured` antes de
 * qualquer custo. Quando houver um provedor real (com chave do próprio operador, guardada como
 * segredo do Worker), ele implementa `AIProvider` e entra em `getAiProvider`. Toda chamada deve ser
 * auditada (`execution.*` + uso) e respeitar as mesmas cotas.
 */
export interface AIGenerateRequest {
  prompt: string;
  maxOutputTokens: number;
}
export interface AIGenerateResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}
export interface AIProvider {
  readonly id: string;
  generate(
    req: AIGenerateRequest,
    ctx: { userId: string; workspaceId: string },
  ): Promise<AIGenerateResult>;
}

/** Nenhum provedor é configurado nesta fase. */
export function getAiProvider(_env: Bindings): AIProvider | null {
  return null;
}

export function aiStatus(env: Bindings): 'configured' | 'not_configured' {
  return getAiProvider(env) ? 'configured' : 'not_configured';
}
