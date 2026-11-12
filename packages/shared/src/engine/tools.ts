import { z } from 'zod';
import { clean, contentWords, frequencies, splitSentences, truncate, words } from './text';

/**
 * Whitelist de ferramentas autorizadas. Todas são DETERMINÍSTICAS (regras, templates e
 * transformações de texto): sem rede, sem I/O, sem eval. `ai.generate` é a única que exige IA e
 * é recusada enquanto nenhum provedor estiver configurado (§7).
 */

export const LOCALES = ['en', 'pt'] as const;
export type ToolLocale = (typeof LOCALES)[number];
export const TONES = ['neutral', 'friendly', 'formal'] as const;

export const MAX_TEXT_CHARS = 30_000;

export const executionInputSchema = z.strictObject({
  text: z.string().max(MAX_TEXT_CHARS).optional(),
  topic: z.string().trim().max(200).optional(),
  tone: z.enum(TONES).optional(),
  count: z.number().int().min(1).max(7).optional(),
  locale: z.enum(LOCALES).optional(),
});
export type ExecutionInput = z.infer<typeof executionInputSchema>;
export type InputKey = 'text' | 'topic' | 'tone' | 'count';

export type PipelineState = Record<string, unknown>;
export interface ToolContext {
  input: ExecutionInput;
  state: PipelineState;
  config: Record<string, unknown>;
  locale: ToolLocale;
}
export interface ToolResult {
  /** Chave em que o resultado fica disponível para os próximos passos e para o template. */
  key: string;
  value: unknown;
}

export interface ToolDef {
  key: string;
  /** Ordem canônica de execução (menor primeiro). O construtor não reordena. */
  stage: number;
  requiresAi: boolean;
  /** `always`: a saída é conteúdo para publicação; exige aprovação humana antes de concluir. */
  approval: 'none' | 'always';
  required: readonly InputKey[];
  optional: readonly InputKey[];
  /** Chave de estado que a ferramenta produz (para placeholders de template). */
  produces: string;
  configSchema: z.ZodType<Record<string, unknown>>;
  run: (ctx: ToolContext) => ToolResult;
}

const empty = z.strictObject({}) as unknown as z.ZodType<Record<string, unknown>>;
const textOf = (ctx: ToolContext): string => {
  const cleaned = ctx.state['clean'];
  return typeof cleaned === 'string' ? cleaned : (ctx.input.text ?? '');
};

// ---------------------------------------------------------------- ferramentas

const cleanTool: ToolDef = {
  key: 'text.clean',
  stage: 10,
  requiresAi: false,
  approval: 'none',
  required: ['text'],
  optional: [],
  produces: 'clean',
  configSchema: empty,
  run: (ctx) => ({ key: 'clean', value: clean(ctx.input.text ?? '') }),
};

const statsTool: ToolDef = {
  key: 'text.stats',
  stage: 20,
  requiresAi: false,
  approval: 'none',
  required: ['text'],
  optional: [],
  produces: 'stats',
  configSchema: empty,
  run: (ctx) => {
    const t = textOf(ctx);
    const wc = words(t).length;
    return {
      key: 'stats',
      value: {
        words: wc,
        characters: t.length,
        sentences: splitSentences(t).length,
        paragraphs: t.split(/\n{2,}/).filter((p) => p.trim()).length,
        readingMinutes: Math.max(wc === 0 ? 0 : 1, Math.ceil(wc / 200)),
      },
    };
  },
};

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/giu;
const linksTool: ToolDef = {
  key: 'text.links',
  stage: 30,
  requiresAi: false,
  approval: 'none',
  required: ['text'],
  optional: [],
  produces: 'links',
  configSchema: empty,
  run: (ctx) => {
    const seen = new Set<string>();
    const out: Array<{ url: string; host: string }> = [];
    for (const raw of textOf(ctx).match(URL_RE) ?? []) {
      const url = raw.replace(/[.,;:!?]+$/u, '');
      if (seen.has(url) || out.length >= 50) continue;
      seen.add(url);
      try {
        out.push({ url, host: new URL(url).hostname });
      } catch {
        /* URL malformada é ignorada */
      }
    }
    return { key: 'links', value: out };
  },
};

const outlineTool: ToolDef = {
  key: 'text.outline',
  stage: 40,
  requiresAi: false,
  approval: 'none',
  required: ['text'],
  optional: [],
  produces: 'outline',
  configSchema: empty,
  run: (ctx) => {
    const out: Array<{ level: number; title: string }> = [];
    for (const line of textOf(ctx).split('\n')) {
      const s = line.trim();
      if (!s || s.length > 90 || out.length >= 40) continue;
      const md = /^(#{1,6})\s+(.+)$/u.exec(s);
      const num = /^(\d+(?:\.\d+)*)[.)]\s+([^.!?]{2,80})$/u.exec(s);
      const caps = s.length >= 4 && s === s.toUpperCase() && /\p{L}/u.test(s) && !/[.!?]$/u.test(s);
      const colon = /^[^.!?]{3,60}:$/u.test(s);
      if (md) out.push({ level: md[1]!.length, title: md[2]!.trim() });
      else if (num) out.push({ level: num[1]!.split('.').length, title: num[2]!.trim() });
      else if (caps) out.push({ level: 1, title: s });
      else if (colon) out.push({ level: 2, title: s.slice(0, -1) });
    }
    return { key: 'outline', value: out };
  },
};

const keywordsTool: ToolDef = {
  key: 'text.keywords',
  stage: 50,
  requiresAi: false,
  approval: 'none',
  required: ['text'],
  optional: [],
  produces: 'keywords',
  configSchema: z.strictObject({ n: z.number().int().min(1).max(20).default(8) }) as never,
  run: (ctx) => {
    const n = typeof ctx.config['n'] === 'number' ? ctx.config['n'] : 8;
    const ws = contentWords(textOf(ctx));
    const freq = frequencies(ws);
    const firstSeen = new Map<string, number>();
    ws.forEach((w, i) => !firstSeen.has(w) && firstSeen.set(w, i));
    const ranked = [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || firstSeen.get(a[0])! - firstSeen.get(b[0])!)
      .slice(0, n)
      .map(([term, count]) => ({ term, count }));
    return { key: 'keywords', value: ranked };
  },
};

const ACTION_RE =
  /^\s*(?:[-*•]\s*)?(?:\[\s?\]\s*)?(?:todo|to-do|action(?:\s+item)?|ação|fazer|next step|próximo passo)\b|\b(?:need(?:s)? to|must|should|has to|have to|precis(?:a|am|amos)\s+(?:de\s+)?|deve(?:m)?\b|tem que|temos que|é necessário)\b/iu;
const actionsTool: ToolDef = {
  key: 'text.actions',
  stage: 60,
  requiresAi: false,
  approval: 'none',
  required: ['text'],
  optional: [],
  produces: 'actions',
  configSchema: empty,
  run: (ctx) => {
    const out: string[] = [];
    for (const s of splitSentences(textOf(ctx))) {
      if (out.length >= 20) break;
      if (ACTION_RE.test(s)) out.push(truncate(s.replace(/^\s*[-*•]\s*/u, ''), 300));
    }
    return { key: 'actions', value: out };
  },
};

const summarizeTool: ToolDef = {
  key: 'text.summarize',
  stage: 70,
  requiresAi: false,
  approval: 'none',
  required: ['text'],
  optional: [],
  produces: 'summary',
  configSchema: z.strictObject({ sentences: z.number().int().min(1).max(10).default(3) }) as never,
  run: (ctx) => {
    const k = typeof ctx.config['sentences'] === 'number' ? ctx.config['sentences'] : 3;
    const sentences = splitSentences(textOf(ctx)).slice(0, 2_000);
    if (sentences.length <= k) return { key: 'summary', value: sentences.join(' ') };
    // Extrativo: pontua cada frase pela frequência das suas palavras de conteúdo.
    const freq = frequencies(contentWords(sentences.join(' ')));
    const scored = sentences.map((s, i) => {
      const ws = contentWords(s);
      const score =
        ws.length === 0 ? 0 : ws.reduce((a, w) => a + (freq.get(w) ?? 0), 0) / Math.sqrt(ws.length);
      return { i, score };
    });
    const top = scored
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, k)
      .sort((a, b) => a.i - b.i);
    return { key: 'summary', value: top.map((t) => sentences[t.i]).join(' ') };
  },
};

// ---- calendário de redes sociais (templates)

const DAYS: Record<ToolLocale, string[]> = {
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  pt: ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'],
};
const TYPES = ['tip', 'question', 'behind', 'story', 'announcement', 'poll', 'recap'] as const;
const TYPE_LABEL: Record<ToolLocale, Record<(typeof TYPES)[number], string>> = {
  en: {
    tip: 'Tip',
    question: 'Question',
    behind: 'Behind the scenes',
    story: 'Story',
    announcement: 'Announcement',
    poll: 'Poll',
    recap: 'Recap',
  },
  pt: {
    tip: 'Dica',
    question: 'Pergunta',
    behind: 'Bastidores',
    story: 'História',
    announcement: 'Novidade',
    poll: 'Enquete',
    recap: 'Resumo',
  },
};
const BODY: Record<ToolLocale, Record<(typeof TYPES)[number], string>> = {
  en: {
    tip: 'One practical tip about {topic}: start small, measure the result and adjust.',
    question: 'What is your biggest challenge with {topic}? Tell us in the comments.',
    behind: 'A look behind the scenes of how we work on {topic}.',
    story: 'A short story about how {topic} changed the way we do things.',
    announcement: 'Something new about {topic} is coming. Stay tuned.',
    poll: 'Quick poll: what matters most to you about {topic}? Reply with your pick.',
    recap: "This week's recap on {topic}: what worked, what did not and what is next.",
  },
  pt: {
    tip: 'Uma dica prática sobre {topic}: comece pequeno, meça o resultado e ajuste.',
    question: 'Qual é o seu maior desafio com {topic}? Conte nos comentários.',
    behind: 'Um olhar nos bastidores de como trabalhamos com {topic}.',
    story: 'Uma pequena história de como {topic} mudou a nossa forma de fazer as coisas.',
    announcement: 'Vem novidade sobre {topic} por aí. Fique ligado.',
    poll: 'Enquete rápida: o que mais importa para você em {topic}? Responda com a sua escolha.',
    recap:
      'Resumo da semana sobre {topic}: o que funcionou, o que não funcionou e os próximos passos.',
  },
};
const TONE_FRAME: Record<ToolLocale, Record<(typeof TONES)[number], [string, string]>> = {
  en: {
    neutral: ['', ''],
    friendly: ['Hey there!', 'Tell us what you think!'],
    formal: ['Good day.', 'Thank you for your attention.'],
  },
  pt: {
    neutral: ['', ''],
    friendly: ['Oi, pessoal!', 'Conta pra gente o que você acha!'],
    formal: ['Prezados,', 'Agradecemos a atenção.'],
  },
};

export interface CalendarPost {
  day: string;
  type: string;
  text: string;
}

const calendarTool: ToolDef = {
  key: 'social.calendar',
  stage: 80,
  requiresAi: false,
  // Conteúdo destinado a publicação: um humano revisa antes de dar por concluído (R6).
  approval: 'always',
  required: ['topic'],
  optional: ['tone', 'count'],
  produces: 'calendar',
  configSchema: empty,
  run: (ctx) => {
    const topic = (ctx.input.topic ?? '').trim();
    const count = ctx.input.count ?? 3;
    const tone = ctx.input.tone ?? 'neutral';
    const [open, close] = TONE_FRAME[ctx.locale][tone];
    const tags = contentWords(topic)
      .slice(0, 3)
      .map((w) => `#${w.charAt(0).toUpperCase()}${w.slice(1).replace(/[^\p{L}\p{N}]/gu, '')}`)
      .join(' ');
    const posts: CalendarPost[] = Array.from({ length: count }, (_, i) => {
      const type = TYPES[i % TYPES.length]!;
      const body = BODY[ctx.locale][type].replace('{topic}', topic);
      const text = [open, body, close, tags].filter(Boolean).join(' ');
      return {
        day: DAYS[ctx.locale][Math.floor((i * 7) / count)]!,
        type: TYPE_LABEL[ctx.locale][type],
        text,
      };
    });
    return { key: 'calendar', value: posts };
  },
};

// ---- template e IA

export const TEMPLATE_MAX = 4_000;
export const PLACEHOLDERS = [
  'text',
  'topic',
  'tone',
  'count',
  'clean',
  'stats',
  'keywords',
  'links',
  'outline',
  'actions',
  'summary',
  'calendar',
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
/** Placeholder -> ferramenta que o produz (entradas diretas não têm). */
export const PLACEHOLDER_PRODUCER: Partial<Record<Placeholder, string>> = {
  clean: 'text.clean',
  stats: 'text.stats',
  keywords: 'text.keywords',
  links: 'text.links',
  outline: 'text.outline',
  actions: 'text.actions',
  summary: 'text.summarize',
  calendar: 'social.calendar',
};

// O template é renderizado pelo pipeline (precisa dos formatadores); aqui só declara config.
const templateTool: ToolDef = {
  key: 'text.template',
  stage: 90,
  requiresAi: false,
  approval: 'none',
  required: [],
  optional: [],
  produces: 'template',
  configSchema: z.strictObject({ template: z.string().min(1).max(TEMPLATE_MAX) }) as never,
  run: () => ({ key: 'template', value: null }),
};

const aiTool: ToolDef = {
  key: 'ai.generate',
  stage: 95,
  requiresAi: true,
  approval: 'always',
  required: ['text'],
  optional: [],
  produces: 'generated',
  configSchema: empty,
  run: () => {
    throw new Error('ai_not_configured');
  },
};

export const TOOLS: readonly ToolDef[] = [
  cleanTool,
  statsTool,
  linksTool,
  outlineTool,
  keywordsTool,
  actionsTool,
  summarizeTool,
  calendarTool,
  templateTool,
  aiTool,
];
const BY_KEY = new Map(TOOLS.map((t) => [t.key, t]));
export const TOOL_KEYS: readonly string[] = TOOLS.map((t) => t.key);
export const getTool = (key: string): ToolDef | undefined => BY_KEY.get(key);
export const isWhitelisted = (key: string): boolean => BY_KEY.has(key);

/** Metadados públicos (sem funções) para a API e a UI. */
export interface ToolMeta {
  key: string;
  stage: number;
  requiresAi: boolean;
  approval: 'none' | 'always';
  required: readonly InputKey[];
  optional: readonly InputKey[];
  produces: string;
}
export const TOOL_META: readonly ToolMeta[] = TOOLS.map(
  ({ key, stage, requiresAi, approval, required, optional, produces }) => ({
    key,
    stage,
    requiresAi,
    approval,
    required,
    optional,
    produces,
  }),
);

/** Entradas que o agente exige/aceita, dada a lista de ferramentas. */
export function inputsFor(toolKeys: readonly string[]): {
  required: InputKey[];
  optional: InputKey[];
} {
  const required = new Set<InputKey>();
  const optional = new Set<InputKey>();
  for (const k of toolKeys) {
    const t = getTool(k);
    t?.required.forEach((r) => required.add(r));
    t?.optional.forEach((o) => optional.add(o));
  }
  required.forEach((r) => optional.delete(r));
  return { required: [...required], optional: [...optional] };
}
