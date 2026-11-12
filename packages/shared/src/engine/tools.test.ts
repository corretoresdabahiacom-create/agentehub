import { describe, expect, it } from 'vitest';
import { runPipeline } from './pipeline';
import { DEFAULT_LIMITS, type AgentLimits } from './limits';
import {
  executionInputSchema,
  getTool,
  inputsFor,
  isWhitelisted,
  TOOL_KEYS,
  TOOL_META,
  type ExecutionInput,
} from './tools';
import { clean, splitSentences } from './text';

const NOTES = `RESEARCH NOTES

Solar energy adoption is growing fast. Solar panels became cheaper every year. Storage remains the main challenge for solar energy.
See https://example.com/solar-report and https://energy.gov/data. Duplicate: https://example.com/solar-report.

Next steps:
- We need to compare battery costs.
- TODO: email the supplier list.
The team should review the policy section.`;

function run(
  tools: string[],
  input: ExecutionInput,
  limits: Partial<AgentLimits> = {},
  format: 'text' | 'markdown' | 'json' = 'markdown',
  configs: Record<string, Record<string, unknown>> = {},
) {
  return runPipeline({
    tools: tools.map((key) => ({ key, config: configs[key] ?? {} })),
    input,
    limits: { ...DEFAULT_LIMITS, ...limits },
    outputFormat: format,
  });
}

describe('whitelist', () => {
  it('só contém ferramentas conhecidas e exatamente uma exige IA', () => {
    expect(TOOL_KEYS).toContain('text.summarize');
    expect(isWhitelisted('shell.exec')).toBe(false);
    expect(getTool('shell.exec')).toBeUndefined();
    expect(TOOL_META.filter((t) => t.requiresAi).map((t) => t.key)).toEqual(['ai.generate']);
    expect(new Set(TOOL_KEYS).size).toBe(TOOL_KEYS.length);
  });
  it('inputsFor combina entradas obrigatórias/opcionais', () => {
    expect(inputsFor(['text.clean', 'text.stats'])).toEqual({ required: ['text'], optional: [] });
    expect(inputsFor(['social.calendar'])).toEqual({
      required: ['topic'],
      optional: ['tone', 'count'],
    });
  });
  it('o esquema de entrada rejeita campos desconhecidos e tipos errados', () => {
    expect(executionInputSchema.safeParse({ text: 'x', evil: 1 }).success).toBe(false);
    expect(executionInputSchema.safeParse({ count: 8 }).success).toBe(false);
    expect(executionInputSchema.safeParse({ tone: 'angry' }).success).toBe(false);
    expect(executionInputSchema.safeParse({ text: 'a'.repeat(30_001) }).success).toBe(false);
  });
});

describe('ferramentas de texto', () => {
  it('clean normaliza espaços, quebras e caracteres de controle', () => {
    expect(clean('a\u0000  b\r\n\r\n\r\n\r\nc \t d  ')).toBe('a b\n\nc d');
  });

  it('stats conta valores reais', () => {
    const r = run(['text.stats'], { text: 'One two three. Four five!\n\nSix.' });
    expect(r.status).toBe('completed');
    if (r.status !== 'failed') {
      expect(r.output.content).toContain('Words: 6');
      expect(r.output.content).toContain('Sentences: 3');
      expect(r.output.content).toContain('Paragraphs: 2');
      expect(r.output.content).toContain('Reading time (min): 1');
    }
  });

  it('links extrai URLs únicas sem pontuação final', () => {
    const r = run(['text.links'], { text: NOTES });
    if (r.status === 'failed') throw new Error('falhou');
    const lines = r.output.content.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toEqual(['- https://example.com/solar-report', '- https://energy.gov/data']);
  });

  it('outline detecta títulos markdown, numerados, em caixa alta e com dois-pontos', () => {
    const text = '# Title\n1. Intro section\nCAPS HEADING\nNext steps:\nThis is a normal sentence.';
    const r = run(['text.outline'], { text });
    if (r.status === 'failed') throw new Error('falhou');
    expect(r.output.content).toContain('- Title');
    expect(r.output.content).toContain('- Intro section');
    expect(r.output.content).toContain('- CAPS HEADING');
    expect(r.output.content).toContain('- Next steps');
    expect(r.output.content).not.toContain('normal sentence');
  });

  it('keywords ordena por frequência (empate: primeira ocorrência), ignora stopwords EN/PT e respeita n', () => {
    const r = run(
      ['text.keywords'],
      { text: 'solar solar solar energia energia the and para storage' },
      {},
      'json',
      { 'text.keywords': { n: 2 } },
    );
    if (r.status === 'failed') throw new Error('falhou');
    expect(JSON.parse(r.output.content).sections.keywords).toEqual([
      { term: 'solar', count: 3 },
      { term: 'energia', count: 2 },
    ]);
  });

  it('actions encontra itens de ação em EN e PT', () => {
    const r = run(['text.actions'], { text: NOTES + '\nPrecisamos de aprovar o orçamento.' });
    if (r.status === 'failed') throw new Error('falhou');
    expect(r.output.content).toContain('We need to compare battery costs.');
    expect(r.output.content).toContain('TODO: email the supplier list.');
    expect(r.output.content).toContain('The team should review the policy section.');
    expect(r.output.content).toContain('Precisamos de aprovar');
  });

  it('summarize é extrativo, mantém a ordem original e é determinístico', () => {
    const a = run(['text.summarize'], { text: NOTES }, {}, 'json', {
      'text.summarize': { sentences: 2 },
    });
    const b = run(['text.summarize'], { text: NOTES }, {}, 'json', {
      'text.summarize': { sentences: 2 },
    });
    if (a.status === 'failed' || b.status === 'failed') throw new Error('falhou');
    expect(a.output.content).toBe(b.output.content);
    const summary: string = JSON.parse(a.output.content).sections.summary;
    const sents = splitSentences(clean(NOTES));
    const picked = sents.filter((s) => summary.includes(s));
    expect(picked).toHaveLength(2);
    expect(summary.indexOf(picked[0]!)).toBeLessThan(summary.indexOf(picked[1]!));
    expect(summary).toMatch(/solar/i);
  });

  it('summarize de texto curto devolve tudo, sem inventar', () => {
    const r = run(['text.summarize'], { text: 'Only one sentence here.' });
    if (r.status === 'failed') throw new Error('falhou');
    expect(r.output.content).toContain('Only one sentence here.');
  });

  it('calendar gera posts determinísticos por tom/idioma/quantidade e sempre pede aprovação', () => {
    const base = { topic: 'healthy cooking', count: 3, tone: 'friendly' as const };
    const a = run(['social.calendar'], base);
    const b = run(['social.calendar'], base);
    expect(a.status).toBe('awaiting_approval');
    if (a.status === 'failed' || b.status === 'failed') throw new Error('falhou');
    expect(a.output.content).toBe(b.output.content);
    expect(a.output.content.match(/^- \*\*/gm)).toHaveLength(3);
    expect(a.output.content).toContain('Hey there!');
    expect(a.output.content).toContain('#Healthy #Cooking');
    const pt = run(['social.calendar'], {
      topic: 'cozinha saudável',
      count: 7,
      locale: 'pt',
      tone: 'formal',
    });
    if (pt.status === 'failed') throw new Error('falhou');
    expect(pt.output.content.match(/^- \*\*/gm)).toHaveLength(7);
    expect(pt.output.content).toContain('Prezados,');
    expect(pt.output.content).toContain('Segunda');
    expect(pt.output.content).toContain('Domingo');
  });
});

describe('pipeline: composição, aprovação e formatos', () => {
  it('executa na ordem canônica, independentemente da ordem declarada', () => {
    const r = run(['text.summarize', 'text.clean', 'text.stats'], { text: NOTES });
    if (r.status === 'failed') throw new Error('falhou');
    expect(r.steps.map((s) => s.name)).toEqual([
      'text.clean',
      'text.stats',
      'text.summarize',
      'compose',
    ]);
    expect(r.steps.every((s) => s.status === 'completed')).toBe(true);
  });

  it('formatos: markdown tem cabeçalhos, text não, json é válido', () => {
    const md = run(['text.stats'], { text: 'Hello world.' }, {}, 'markdown');
    const tx = run(['text.stats'], { text: 'Hello world.' }, {}, 'text');
    const js = run(['text.stats'], { text: 'Hello world.' }, {}, 'json');
    if (md.status === 'failed' || tx.status === 'failed' || js.status === 'failed')
      throw new Error('falhou');
    expect(md.output.content).toContain('## Statistics');
    expect(md.output.mimeType).toBe('text/markdown');
    expect(tx.output.content).not.toContain('##');
    expect(JSON.parse(js.output.content).sections.stats.words).toBe(2);
    expect(js.output.mimeType).toBe('application/json');
  });

  it('idioma PT usa cabeçalhos em português', () => {
    const r = run(['text.stats'], { text: 'Olá mundo.', locale: 'pt' });
    if (r.status === 'failed') throw new Error('falhou');
    expect(r.output.content).toContain('## Estatísticas');
    expect(r.output.content).toContain('Palavras: 2');
  });

  it('template substitui placeholders conhecidos; desconhecidos viram vazio; sem avaliação de código', () => {
    const r = run(
      ['text.stats', 'text.summarize', 'text.template'],
      { text: 'Alpha beta gamma. Delta.', topic: 'T' },
      {},
      'markdown',
      {
        'text.template': {
          template:
            'Topic={{topic}} | {{ summary }} | {{stats}} | {{nope}} | ${process.env} {{constructor}}',
        },
      },
    );
    if (r.status === 'failed') throw new Error('falhou');
    expect(r.output.content).toContain('Topic=T');
    expect(r.output.content).toContain('Alpha beta gamma.');
    expect(r.output.content).toContain('- Words: 4');
    expect(r.output.content).toContain('|  |');
    expect(r.output.content).toContain('${process.env}');
    expect(r.steps.map((s) => s.name)).toEqual(['text.stats', 'text.summarize', 'compose']);
  });

  it('requireApproval do agente força awaiting_approval mesmo com ferramentas comuns', () => {
    expect(run(['text.stats'], { text: 'x y' }, { requireApproval: true }).status).toBe(
      'awaiting_approval',
    );
    expect(run(['text.stats'], { text: 'x y' }, { requireApproval: false }).status).toBe(
      'completed',
    );
  });
});

describe('pipeline: limites e recusas (sem loop infinito)', () => {
  it('recusa ferramenta fora da whitelist antes de rodar qualquer passo', () => {
    const r = run(['text.clean', 'shell.exec'], { text: 'x' });
    expect(r).toMatchObject({ status: 'failed', error: 'unknown_tool', detail: 'shell.exec' });
    expect(r.steps).toHaveLength(0);
  });

  it('recusa ferramenta que exige IA (nenhum provedor configurado), sem passos', () => {
    const r = run(['text.clean', 'ai.generate'], { text: 'x' });
    expect(r).toMatchObject({ status: 'failed', error: 'ai_not_configured' });
    expect(r.steps).toHaveLength(0);
  });

  it('limite de tamanho de entrada', () => {
    expect(run(['text.clean'], { text: 'a'.repeat(101) }, { maxInputChars: 100 })).toMatchObject({
      status: 'failed',
      error: 'limit_input',
    });
    expect(run(['text.clean'], { text: 'a'.repeat(100) }, { maxInputChars: 100 }).status).toBe(
      'completed',
    );
  });

  it('limite de passos conta o passo de composição', () => {
    expect(run(['text.clean', 'text.stats'], { text: 'x' }, { maxSteps: 2 })).toMatchObject({
      status: 'failed',
      error: 'limit_steps',
    });
    expect(run(['text.clean', 'text.stats'], { text: 'x' }, { maxSteps: 3 }).status).toBe(
      'completed',
    );
  });

  it('entrada obrigatória ausente ou em branco', () => {
    expect(run(['text.clean'], {})).toMatchObject({
      status: 'failed',
      error: 'missing_input',
      detail: 'text',
    });
    expect(run(['social.calendar'], { topic: '   ' })).toMatchObject({
      status: 'failed',
      error: 'missing_input',
      detail: 'topic',
    });
  });

  it('configuração inválida de ferramenta', () => {
    expect(
      run(['text.keywords'], { text: 'x' }, {}, 'text', { 'text.keywords': { n: 99 } }),
    ).toMatchObject({ status: 'failed', error: 'bad_config' });
    expect(
      run(['text.keywords'], { text: 'x' }, {}, 'text', { 'text.keywords': { evil: true } }),
    ).toMatchObject({ status: 'failed', error: 'bad_config' });
  });

  it('tempo: usa relógio injetado e marca o passo que estourou', () => {
    let t = 0;
    const r = runPipeline({
      tools: [{ key: 'text.clean' }, { key: 'text.stats' }],
      input: { text: 'hello world' },
      limits: { ...DEFAULT_LIMITS, maxDurationMs: 100 },
      outputFormat: 'text',
      now: () => (t += 60),
    });
    expect(r).toMatchObject({ status: 'failed', error: 'timeout' });
    expect(r.steps.at(-1)).toMatchObject({ status: 'failed', error: 'timeout' });
  });

  it('saída acima do teto da plataforma falha em vez de gravar', () => {
    const text = Array.from({ length: 29 }, () => 'a'.repeat(1_000)).join('\n\n');
    const r = run(['text.clean', 'text.template'], { text }, { maxInputChars: 30_000 }, 'text', {
      'text.template': { template: '{{clean}}'.repeat(10) },
    });
    expect(r).toMatchObject({ status: 'failed', error: 'output_too_large' });
  });

  it('termina em tempo limitado mesmo com a entrada máxima (sem laço)', () => {
    const text = Array.from(
      { length: 3_000 },
      (_, i) => `Sentence number ${i} talks about solar energy and storage.`,
    )
      .join(' ')
      .slice(0, 30_000);
    const t0 = performance.now();
    const r = run(
      [
        'text.clean',
        'text.stats',
        'text.links',
        'text.outline',
        'text.keywords',
        'text.actions',
        'text.summarize',
      ],
      { text },
      { maxInputChars: 30_000 },
    );
    expect(r.status).toBe('completed');
    expect(performance.now() - t0).toBeLessThan(1_000);
  });
});
