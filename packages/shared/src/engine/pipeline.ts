import { PLATFORM_LIMITS, type AgentLimits } from './limits';
import {
  getTool,
  PLACEHOLDERS,
  type CalendarPost,
  type ExecutionInput,
  type ToolLocale,
  type PipelineState,
  type ToolDef,
} from './tools';

export const OUTPUT_FORMATS = ['text', 'markdown', 'json'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
export const MIME: Record<OutputFormat, string> = {
  text: 'text/plain',
  markdown: 'text/markdown',
  json: 'application/json',
};

export type PipelineErrorCode =
  | 'unknown_tool'
  | 'ai_not_configured'
  | 'limit_input'
  | 'limit_steps'
  | 'timeout'
  | 'output_too_large'
  | 'missing_input'
  | 'bad_config'
  | 'tool_error';

export interface StepRecord {
  seq: number;
  name: string;
  status: 'completed' | 'failed' | 'skipped';
  startedAt: number;
  finishedAt: number;
  /** Prévia curta (texto) do resultado do passo. */
  preview: string | null;
  error: string | null;
}

export type PipelineResult =
  | {
      status: 'completed' | 'awaiting_approval';
      steps: StepRecord[];
      output: { content: string; mimeType: string };
    }
  | { status: 'failed'; steps: StepRecord[]; error: PipelineErrorCode; detail?: string };

export interface PipelineParams {
  tools: ReadonlyArray<{ key: string; config?: Record<string, unknown> }>;
  input: ExecutionInput;
  limits: AgentLimits;
  outputFormat: OutputFormat;
  /** Relógio injetável (testes). No Workers o relógio só avança em I/O: limite de tempo é melhor esforço. */
  now?: () => number;
}

// ------------------------------------------------------------- formatação

const HEADINGS: Record<ToolLocale, Record<string, string>> = {
  en: {
    summary: 'Summary',
    keywords: 'Key terms',
    links: 'Links found',
    outline: 'Outline',
    actions: 'Action items',
    stats: 'Statistics',
    calendar: 'Weekly calendar',
    clean: 'Cleaned text',
  },
  pt: {
    summary: 'Resumo',
    keywords: 'Termos-chave',
    links: 'Links encontrados',
    outline: 'Estrutura',
    actions: 'Itens de ação',
    stats: 'Estatísticas',
    calendar: 'Calendário semanal',
    clean: 'Texto limpo',
  },
};
const STAT_LABELS: Record<ToolLocale, Record<string, string>> = {
  en: {
    words: 'Words',
    characters: 'Characters',
    sentences: 'Sentences',
    paragraphs: 'Paragraphs',
    readingMinutes: 'Reading time (min)',
  },
  pt: {
    words: 'Palavras',
    characters: 'Caracteres',
    sentences: 'Frases',
    paragraphs: 'Parágrafos',
    readingMinutes: 'Tempo de leitura (min)',
  },
};
const NONE: Record<ToolLocale, string> = { en: 'None found.', pt: 'Nada encontrado.' };

/** Valor -> markdown. Usado pelo compositor padrão e pelos placeholders de template. */
export function renderValue(key: string, value: unknown, locale: ToolLocale): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  const isEmptyList = Array.isArray(value) && value.length === 0;
  if (isEmptyList) return NONE[locale];
  switch (key) {
    case 'stats':
      return Object.entries(value as Record<string, number>)
        .map(([k, v]) => `- ${STAT_LABELS[locale][k] ?? k}: ${v}`)
        .join('\n');
    case 'keywords':
      return (value as Array<{ term: string; count: number }>)
        .map((k) => `- ${k.term} (${k.count})`)
        .join('\n');
    case 'links':
      return (value as Array<{ url: string }>).map((l) => `- ${l.url}`).join('\n');
    case 'outline':
      return (value as Array<{ level: number; title: string }>)
        .map((o) => `${'  '.repeat(Math.max(0, o.level - 1))}- ${o.title}`)
        .join('\n');
    case 'actions':
      return (value as string[]).map((a) => `- ${a}`).join('\n');
    case 'calendar':
      return (value as CalendarPost[])
        .map((p) => `- **${p.day} — ${p.type}:** ${p.text}`)
        .join('\n');
    default:
      return JSON.stringify(value);
  }
}

const SECTION_ORDER = [
  'summary',
  'keywords',
  'links',
  'outline',
  'actions',
  'stats',
  'calendar',
] as const;

function plain(md: string): string {
  return md.replace(/\*\*/g, '').replace(/^#{1,6}\s+/gm, '');
}

function renderTemplate(
  template: string,
  input: ExecutionInput,
  state: PipelineState,
  locale: ToolLocale,
): string {
  const known = new Set<string>(PLACEHOLDERS);
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, name: string) => {
    if (!known.has(name)) return '';
    const v = name in state ? state[name] : (input as Record<string, unknown>)[name];
    return renderValue(name, v, locale);
  });
}

function compose(params: PipelineParams, state: PipelineState, locale: ToolLocale): string {
  const template = params.tools.find((t) => t.key === 'text.template')?.config?.['template'];
  const keys = SECTION_ORDER.filter((k) => k in state);
  if (typeof template === 'string') {
    const out = renderTemplate(template, params.input, state, locale);
    return params.outputFormat === 'markdown'
      ? out
      : params.outputFormat === 'json'
        ? JSON.stringify({ content: out }, null, 2)
        : plain(out);
  }
  if (params.outputFormat === 'json') {
    return JSON.stringify(
      { sections: Object.fromEntries(keys.map((k) => [k, state[k]])) },
      null,
      2,
    );
  }
  const md = keys
    .map((k) => `## ${HEADINGS[locale][k]}\n\n${renderValue(k, state[k], locale)}`)
    .join('\n\n');
  return params.outputFormat === 'markdown' ? md : plain(md);
}

const preview = (key: string, v: unknown, locale: ToolLocale): string => {
  const s = renderValue(key, v, locale);
  return s.length > 300 ? `${s.slice(0, 299)}…` : s;
};

// --------------------------------------------------------------- execução

/**
 * Pipeline linear e finito: as ferramentas autorizadas rodam UMA vez, na ordem canônica (`stage`),
 * seguidas de um passo de composição. Não há laços, recursão nem chamadas externas, então não
 * existe execução infinita por construção; os limites (entrada, passos, tempo, saída) são checados.
 */
export function runPipeline(params: PipelineParams): PipelineResult {
  const now = params.now ?? Date.now;
  const started = now();
  const { limits, input } = params;
  const locale: ToolLocale = input.locale ?? 'en';
  const steps: StepRecord[] = [];
  const fail = (error: PipelineErrorCode, detail?: string): PipelineResult => ({
    status: 'failed',
    steps,
    error,
    ...(detail ? { detail } : {}),
  });

  // 1) Verificações prévias: nada roda se alguma falhar.
  const defs: Array<{ def: ToolDef; config: Record<string, unknown> }> = [];
  for (const t of params.tools) {
    const def = getTool(t.key);
    if (!def) return fail('unknown_tool', t.key);
    if (def.requiresAi) return fail('ai_not_configured', t.key);
    const parsed = def.configSchema.safeParse(t.config ?? {});
    if (!parsed.success) return fail('bad_config', t.key);
    defs.push({ def, config: parsed.data });
  }
  defs.sort((a, b) => a.def.stage - b.def.stage);
  const runnable = defs.filter((d) => d.def.key !== 'text.template');
  if (runnable.length + 1 > limits.maxSteps)
    return fail('limit_steps', String(runnable.length + 1));
  if ((input.text ?? '').length > limits.maxInputChars) return fail('limit_input');
  for (const { def } of defs) {
    for (const k of def.required) {
      const v = input[k];
      if (v === undefined || (typeof v === 'string' && v.trim() === ''))
        return fail('missing_input', k);
    }
  }

  // 2) Passos.
  const state: PipelineState = {};
  let seq = 0;
  for (const { def, config } of runnable) {
    const t0 = now();
    seq += 1;
    if (t0 - started > limits.maxDurationMs) {
      steps.push({
        seq,
        name: def.key,
        status: 'failed',
        startedAt: t0,
        finishedAt: t0,
        preview: null,
        error: 'timeout',
      });
      return fail('timeout');
    }
    try {
      const r = def.run({ input, state, config, locale });
      state[r.key] = r.value;
      steps.push({
        seq,
        name: def.key,
        status: 'completed',
        startedAt: t0,
        finishedAt: now(),
        preview: preview(r.key, r.value, locale),
        error: null,
      });
    } catch (e) {
      steps.push({
        seq,
        name: def.key,
        status: 'failed',
        startedAt: t0,
        finishedAt: now(),
        preview: null,
        error: 'tool_error',
      });
      return fail('tool_error', e instanceof Error ? e.message.slice(0, 120) : undefined);
    }
  }

  // 3) Composição final.
  const t0 = now();
  seq += 1;
  if (t0 - started > limits.maxDurationMs) {
    steps.push({
      seq,
      name: 'compose',
      status: 'failed',
      startedAt: t0,
      finishedAt: t0,
      preview: null,
      error: 'timeout',
    });
    return fail('timeout');
  }
  const content = compose(params, state, locale);
  if (content.length > PLATFORM_LIMITS.maxOutputChars) {
    steps.push({
      seq,
      name: 'compose',
      status: 'failed',
      startedAt: t0,
      finishedAt: now(),
      preview: null,
      error: 'output_too_large',
    });
    return fail('output_too_large');
  }
  steps.push({
    seq,
    name: 'compose',
    status: 'completed',
    startedAt: t0,
    finishedAt: now(),
    preview: `${content.length} chars`,
    error: null,
  });

  const needsApproval = limits.requireApproval || defs.some((d) => d.def.approval === 'always');
  return {
    status: needsApproval ? 'awaiting_approval' : 'completed',
    steps,
    output: { content, mimeType: MIME[params.outputFormat] },
  };
}

/** Aprovação é necessária para este agente? (usado pela UI antes de executar) */
export function requiresApproval(toolKeys: readonly string[], limits: AgentLimits): boolean {
  return limits.requireApproval || toolKeys.some((k) => getTool(k)?.approval === 'always');
}
