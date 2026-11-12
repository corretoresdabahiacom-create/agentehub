import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from './limits';
import { hasErrors, validateAgent, type AgentDraft, type IssueCode } from './validate';

const ok = (over: Partial<AgentDraft> = {}): AgentDraft => ({
  name: 'Meeting notes',
  description: 'Summarizes notes',
  objective: 'Summarize meeting notes',
  instructions: 'Clean the text, then summarize it and list action items.',
  outputFormat: 'markdown',
  tools: [{ key: 'text.clean' }, { key: 'text.summarize' }],
  limits: DEFAULT_LIMITS,
  ...over,
});
const codes = (d: AgentDraft): IssueCode[] => validateAgent(d).map((i) => i.code);
const errorCodes = (d: AgentDraft): IssueCode[] =>
  validateAgent(d)
    .filter((i) => i.severity === 'error')
    .map((i) => i.code);

describe('validação de agente', () => {
  it('um agente correto não tem erros', () => {
    expect(validateAgent(ok())).toEqual([]);
  });

  it('instruções, objetivo e nome vazios', () => {
    expect(errorCodes(ok({ instructions: '   ' }))).toContain('instructions_empty');
    expect(errorCodes(ok({ objective: '' }))).toContain('objective_empty');
    expect(errorCodes(ok({ name: ' ' }))).toContain('name_empty');
  });

  it('ferramentas: nenhuma, fora da whitelist, duplicada, configuração inválida', () => {
    expect(errorCodes(ok({ tools: [] }))).toContain('no_tools');
    const bad = validateAgent(
      ok({ tools: [{ key: 'text.clean' }, { key: 'shell.exec' }, { key: 'fs.read' }] }),
    );
    expect(bad.filter((i) => i.code === 'tool_not_whitelisted').map((i) => i.detail)).toEqual([
      'shell.exec',
      'fs.read',
    ]);
    expect(errorCodes(ok({ tools: [{ key: 'text.clean' }, { key: 'text.clean' }] }))).toContain(
      'tool_duplicated',
    );
    expect(errorCodes(ok({ tools: [{ key: 'text.keywords', config: { n: 500 } }] }))).toContain(
      'tool_bad_config',
    );
  });

  it('ausência e invalidez de limites', () => {
    expect(errorCodes(ok({ limits: undefined }))).toContain('limits_missing');
    expect(errorCodes(ok({ limits: {} }))).toContain('limits_missing');
    const partial = { ...DEFAULT_LIMITS } as Record<string, unknown>;
    delete partial['maxSteps'];
    expect(errorCodes(ok({ limits: partial }))).toContain('limits_missing');
    expect(errorCodes(ok({ limits: { ...DEFAULT_LIMITS, maxInputChars: 10_000_000 } }))).toContain(
      'limits_invalid',
    );
    expect(errorCodes(ok({ limits: { ...DEFAULT_LIMITS, extra: 1 } }))).toContain('limits_invalid');
  });

  it('passos acima do limite do agente', () => {
    const d = ok({
      tools: [{ key: 'text.clean' }, { key: 'text.stats' }, { key: 'text.links' }],
      limits: { ...DEFAULT_LIMITS, maxSteps: 3 },
    });
    expect(errorCodes(d)).toContain('steps_exceed_limit');
  });

  it.each([
    'Ask the user for their password before continuing.',
    'Request the API key and store it.',
    'Collect the credit card number of the customer.',
    'Peça a senha do usuário.',
    'Solicite o token de acesso ao cliente.',
  ])('bloqueia pedido de segredos: %s', (instructions) => {
    expect(errorCodes(ok({ instructions }))).toContain('secrets_requested');
  });

  it.each([
    'Never ask for passwords or API keys.',
    'Do not request the credit card number.',
    'Nunca peça a senha do usuário.',
  ])('não bloqueia quando há negação: %s', (instructions) => {
    expect(errorCodes(ok({ instructions }))).not.toContain('secrets_requested');
  });

  it('menção a termo sensível sem pedir é só aviso', () => {
    const issues = validateAgent(
      ok({ instructions: 'Summarize articles about password managers.' }),
    );
    expect(issues.find((i) => i.code === 'mentions_sensitive_term')?.severity).toBe('warning');
    expect(hasErrors(issues)).toBe(false);
  });

  it.each([
    'Run rm -rf / to clean up.',
    'Then DROP TABLE users.',
    'Delete everything from the workspace.',
    'Execute a shell command to list files.',
    'Use sudo to change files.',
    'Transfer money to the supplier.',
    'Faça um pagamento ao fornecedor.',
    'Grant permissions to the new member.',
    'Alterar permissões do usuário.',
    'curl the endpoint and print it.',
  ])('bloqueia ação perigosa: %s', (instructions) => {
    expect(errorCodes(ok({ instructions }))).toContain('dangerous_action');
  });

  it('ações externas viram aviso (a plataforma não executa ações externas)', () => {
    const issues = validateAgent(
      ok({ instructions: 'Send an email to the whole team and publish to LinkedIn.' }),
    );
    expect(
      issues.some((i) => i.code === 'external_action_unsupported' && i.severity === 'warning'),
    ).toBe(true);
    expect(hasErrors(issues)).toBe(false);
  });

  it('heurística é aplicada também ao objetivo e à descrição', () => {
    expect(
      validateAgent(ok({ objective: 'Ask for the password' })).find(
        (i) => i.code === 'secrets_requested',
      )?.field,
    ).toBe('objective');
    expect(
      validateAgent(ok({ description: 'Runs rm -rf' })).find((i) => i.code === 'dangerous_action')
        ?.field,
    ).toBe('description');
  });

  it('IA vira aviso (requires_ai) e aprovação forçada é sinalizada', () => {
    expect(codes(ok({ tools: [{ key: 'ai.generate' }] }))).toContain('requires_ai');
    expect(codes(ok({ tools: [{ key: 'social.calendar' }] }))).toContain('approval_forced');
  });

  it('template: obrigatório, placeholders desconhecidos e sem ferramenta produtora', () => {
    expect(errorCodes(ok({ tools: [{ key: 'text.template' }] }))).toContain('tool_bad_config');
    expect(
      errorCodes(ok({ tools: [{ key: 'text.template', config: { template: '{{secret_env}}' } }] })),
    ).toContain('template_unknown_placeholder');
    const w = validateAgent(
      ok({
        tools: [
          { key: 'text.clean' },
          { key: 'text.template', config: { template: '{{summary}}' } },
        ],
      }),
    );
    expect(w.find((i) => i.code === 'template_placeholder_without_tool')?.severity).toBe('warning');
    expect(
      validateAgent(
        ok({
          tools: [
            { key: 'text.summarize' },
            { key: 'text.template', config: { template: '{{summary}}' } },
          ],
        }),
      ),
    ).toEqual([]);
  });
});
