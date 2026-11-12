import { z } from 'zod';
import { agentLimitsSchema } from './limits';
import { OUTPUT_FORMATS } from './pipeline';
import {
  getTool,
  isWhitelisted,
  PLACEHOLDER_PRODUCER,
  PLACEHOLDERS,
  TEMPLATE_MAX,
  type Placeholder,
} from './tools';

/**
 * Validação de agente ANTES de publicar. As verificações de segredos, ações externas e comandos
 * são HEURÍSTICAS por palavras-chave (EN/PT): podem ter falsos positivos e falsos negativos e NÃO
 * são garantia de segurança. A barreira real é a whitelist de ferramentas determinísticas.
 */
export type IssueCode =
  | 'name_empty'
  | 'name_too_long'
  | 'objective_empty'
  | 'instructions_empty'
  | 'instructions_too_long'
  | 'no_tools'
  | 'tool_not_whitelisted'
  | 'tool_duplicated'
  | 'tool_bad_config'
  | 'limits_missing'
  | 'limits_invalid'
  | 'steps_exceed_limit'
  | 'output_format_invalid'
  | 'secrets_requested'
  | 'mentions_sensitive_term'
  | 'dangerous_action'
  | 'external_action_unsupported'
  | 'template_missing'
  | 'template_unknown_placeholder'
  | 'template_placeholder_without_tool'
  | 'requires_ai'
  | 'approval_forced';

export interface Issue {
  code: IssueCode;
  severity: 'error' | 'warning';
  field?: string;
  detail?: string;
}

export const agentDraftSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  objective: z.string().trim().max(500).default(''),
  instructions: z.string().trim().max(4000).default(''),
  outputFormat: z.enum(OUTPUT_FORMATS).default('markdown'),
  tools: z
    .array(
      z.object({ key: z.string().max(64), config: z.record(z.string(), z.unknown()).optional() }),
    )
    .max(20),
  limits: z.unknown(),
});
export type AgentDraft = z.input<typeof agentDraftSchema>;

const SENSITIVE =
  'passwords?|passcodes?|senhas?|api[ _-]?keys?|chaves? de api|secrets?|segredos?|tokens?|credentials?|credenciais|credencial|private keys?|chaves? privadas?|credit cards?|cart(?:ão|ões|ao) de cr[eé]dito|card numbers?|n[úu]mero do cart[ãa]o|cvv|cvc';
const ASK =
  'ask|request|collect|prompt|require|obtain|get|enter|provide|send|share|type|pe[çc]a|pedir|solicite|solicitar|colete|coletar|pergunte|informe|forne[çc]a|envie|compartilhe|digite|exija';
const NEGATION =
  /\b(never|do not|don'?t|must not|without|nunca|jamais|n[ãa]o|sem)\b[^.\n]{0,40}$/iu;

const SECRET_ASK = new RegExp(`\\b(?:${ASK})\\b[^.\\n]{0,60}?\\b(?:${SENSITIVE})\\b`, 'giu');
const SENSITIVE_ANY = new RegExp(`\\b(?:${SENSITIVE})\\b`, 'iu');

const DANGEROUS: RegExp[] = [
  /\brm\s+-rf\b/iu,
  /\bdrop\s+(?:table|database)\b/iu,
  /\b(?:delete|erase|wipe|apagar|excluir|deletar)\s+(?:all|everything|tudo|todos|todas)\b/iu,
  /\b(?:transfer|wire)\s+(?:money|funds)\b|\btransferir\s+(?:dinheiro|fundos)\b|\b(?:fazer|fa[çc]a|faz|efetuar|efetue)\s+(?:um\s+)?pagamento\b|\bpix\b/iu,
  /\b(?:execute|run|executar|rodar)\s+(?:an?\s+|um\s+|uma\s+)?(?:shell|bash|command|comando|script)\b/iu,
  /\bsudo\b|\beval\s*\(|\bchmod\b|\bcurl\b|\bwget\b/iu,
  /\b(?:change|alter|grant|alterar|conceder|mudar)\s+(?:user\s+)?(?:permissions?|roles?|permiss(?:ão|ões|ao|oes)|pap[eé]is)\b/iu,
];
const EXTERNAL: RegExp[] = [
  /\b(?:send|enviar)\s+(?:an?\s+|um\s+)?(?:e-?mails?|sms|whatsapp)\b/iu,
  /\b(?:post|publish|publicar|postar)\s+(?:to|on|no|na|em)\s+(?:twitter|x|facebook|instagram|linkedin|tiktok)\b/iu,
];

/** Encontra um padrão que NÃO esteja precedido por negação ("never ask for passwords"). */
function hit(text: string, re: RegExp): boolean {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(g)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 45), m.index ?? 0);
    if (!NEGATION.test(before)) return true;
  }
  return false;
}

export function validateAgent(input: AgentDraft): Issue[] {
  const issues: Issue[] = [];
  const add = (code: IssueCode, severity: Issue['severity'], field?: string, detail?: string) =>
    issues.push({ code, severity, ...(field ? { field } : {}), ...(detail ? { detail } : {}) });

  const name = (input.name ?? '').trim();
  if (!name) add('name_empty', 'error', 'name');
  else if (name.length > 80) add('name_too_long', 'error', 'name');
  if (!(input.objective ?? '').trim()) add('objective_empty', 'error', 'objective');
  const instructions = (input.instructions ?? '').trim();
  if (!instructions) add('instructions_empty', 'error', 'instructions');
  else if (instructions.length > 4000) add('instructions_too_long', 'error', 'instructions');
  if (!OUTPUT_FORMATS.includes((input.outputFormat ?? 'markdown') as never))
    add('output_format_invalid', 'error', 'outputFormat');

  // Ferramentas
  const tools = input.tools ?? [];
  if (tools.length === 0) add('no_tools', 'error', 'tools');
  const seen = new Set<string>();
  for (const t of tools) {
    if (!isWhitelisted(t.key)) {
      add('tool_not_whitelisted', 'error', 'tools', t.key);
      continue;
    }
    if (seen.has(t.key)) {
      add('tool_duplicated', 'error', 'tools', t.key);
      continue;
    }
    seen.add(t.key);
    const def = getTool(t.key)!;
    if (!def.configSchema.safeParse(t.config ?? {}).success)
      add('tool_bad_config', 'error', 'tools', t.key);
    if (def.requiresAi) add('requires_ai', 'warning', 'tools', t.key);
    if (def.approval === 'always') add('approval_forced', 'warning', 'tools', t.key);
  }

  // Limites

  if (input.limits === undefined || input.limits === null) add('limits_missing', 'error', 'limits');
  else {
    const p = agentLimitsSchema.safeParse(input.limits);
    if (!p.success) {
      const missing = p.error.issues.some(
        (i) => i.code === 'invalid_type' && (i as { input?: unknown }).input === undefined,
      );
      add(
        missing ? 'limits_missing' : 'limits_invalid',
        'error',
        'limits',
        p.error.issues[0]?.path.join('.'),
      );
    } else {
      const runnable = tools.filter(
        (t) => isWhitelisted(t.key) && t.key !== 'text.template',
      ).length;
      if (runnable + 1 > p.data.maxSteps)
        add('steps_exceed_limit', 'error', 'limits', `${runnable + 1} > ${p.data.maxSteps}`);
    }
  }

  // Template
  const tpl = tools.find((t) => t.key === 'text.template');
  if (tpl) {
    const template = tpl.config?.['template'];
    if (typeof template !== 'string' || !template.trim())
      add('template_missing', 'error', 'tools', 'text.template');
    else if (template.length <= TEMPLATE_MAX) {
      for (const m of template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
        const ph = m[1] as string;
        if (!(PLACEHOLDERS as readonly string[]).includes(ph))
          add('template_unknown_placeholder', 'error', 'tools', ph);
        else {
          const producer = PLACEHOLDER_PRODUCER[ph as Placeholder];
          if (producer && !seen.has(producer))
            add('template_placeholder_without_tool', 'warning', 'tools', ph);
        }
      }
    }
  }

  // Heurísticas de texto livre (declaradas como melhor esforço).
  const free = [
    ['objective', input.objective ?? ''],
    ['description', input.description ?? ''],
    ['instructions', instructions],
  ] as const;
  for (const [field, text] of free) {
    if (!text) continue;
    if (hit(text, SECRET_ASK)) add('secrets_requested', 'error', field);
    else if (SENSITIVE_ANY.test(text) && !NEGATION.test(text))
      add('mentions_sensitive_term', 'warning', field);
    if (DANGEROUS.some((re) => hit(text, re))) add('dangerous_action', 'error', field);
    if (EXTERNAL.some((re) => hit(text, re))) add('external_action_unsupported', 'warning', field);
  }
  return issues;
}

export const hasErrors = (issues: readonly Issue[]): boolean =>
  issues.some((i) => i.severity === 'error');
