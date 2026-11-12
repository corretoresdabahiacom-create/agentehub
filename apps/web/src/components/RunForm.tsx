import { inputsFor, type ExecutionInput } from '@agenthub/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { errorKey } from '../lib/api';
import { RUN_ERRORS } from '../lib/errors';
import { useOnline } from '../lib/online';
import { useConfig, useRunAgent } from '../lib/queries';
import { btnPrimary, card, field } from '../lib/ui';

export interface RunFormProps {
  slug: string;
  toolKeys: string[];
  maxInputChars: number;
  requiresApproval: boolean;
  requiresAi: boolean;
  workspaces: Array<{ id: string; label: string }>;
  /** Workspaces onde o agente está instalado (omitido: instalação não é exigida). */
  installedIn?: string[];
  /** Mensagem quando a execução está indisponível (ex.: agente não instalado neste workspace). */
  blocked?: string | null;
}

/** Formulário de execução: só mostra as entradas que as ferramentas do agente realmente usam. */
export function RunForm(p: RunFormProps) {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const navigate = useNavigate();
  const config = useConfig();
  const run = useRunAgent();
  const inputs = inputsFor(p.toolKeys);
  const wants = (k: 'text' | 'topic' | 'tone' | 'count') =>
    inputs.required.includes(k) || inputs.optional.includes(k);
  const [workspaceId, setWorkspaceId] = useState('');
  const [text, setText] = useState('');
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState<'neutral' | 'friendly' | 'formal'>('neutral');
  const [count, setCount] = useState(3);
  const ws = workspaceId || p.workspaces[0]?.id || '';
  const aiOff = p.requiresAi && config.data?.ai.status !== 'configured';
  const notInstalled = p.installedIn !== undefined && !p.installedIn.includes(ws);
  const blocked = aiOff
    ? t('run.aiOff')
    : notInstalled
      ? t('run.notInstalled')
      : (p.blocked ?? null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: ExecutionInput = {
      locale: i18n.language.startsWith('pt') ? 'pt' : 'en',
      ...(wants('text') ? { text } : {}),
      ...(wants('topic') ? { topic } : {}),
      ...(wants('tone') ? { tone } : {}),
      ...(wants('count') ? { count } : {}),
    };
    run.mutate(
      { agentSlug: p.slug, workspaceId: ws, input },
      { onSuccess: (d) => void navigate(`/runs/${d.id}`) },
    );
  };

  return (
    <form
      onSubmit={submit}
      className={`${card} space-y-3`}
      aria-labelledby="run-title"
      data-testid="run-form"
    >
      <h2 id="run-title" className="font-semibold">
        {t('run.title')}
      </h2>
      {p.requiresApproval && (
        <p
          role="note"
          className="rounded bg-amber-50 p-2 text-sm text-amber-900"
          data-testid="approval-note"
        >
          {t('run.approvalNote')}
        </p>
      )}
      {blocked && (
        <p role="note" className="text-sm text-[var(--text-muted)]" data-testid="run-blocked">
          {blocked}
        </p>
      )}
      {p.workspaces.length > 1 && (
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">{t('market.workspace')}</span>
          <select className={field} value={ws} onChange={(e) => setWorkspaceId(e.target.value)}>
            {p.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {wants('text') && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('run.text')}</span>
          <textarea
            className={`${field} min-h-32`}
            value={text}
            maxLength={p.maxInputChars}
            onChange={(e) => setText(e.target.value)}
            required={inputs.required.includes('text')}
          />
          <span className="text-xs text-[var(--text-muted)]">
            {t('run.chars', { count: text.length, max: p.maxInputChars })}
          </span>
        </label>
      )}
      {wants('topic') && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('run.topic')}</span>
          <input
            className={field}
            value={topic}
            maxLength={200}
            onChange={(e) => setTopic(e.target.value)}
            required={inputs.required.includes('topic')}
          />
        </label>
      )}
      {wants('tone') && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('run.tone')}</span>
          <select
            className={field}
            value={tone}
            onChange={(e) => setTone(e.target.value as typeof tone)}
          >
            {(['neutral', 'friendly', 'formal'] as const).map((v) => (
              <option key={v} value={v}>
                {t(`run.tones.${v}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      {wants('count') && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('run.count')}</span>
          <input
            type="number"
            min={1}
            max={7}
            className={field}
            value={count}
            onChange={(e) => setCount(Math.min(7, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
      )}
      <button
        type="submit"
        className={btnPrimary}
        disabled={!online || run.isPending || !ws || Boolean(blocked)}
      >
        {t('run.action')}
      </button>
      {!online && <p className="text-sm text-amber-700">{t('auth.offlineBlocked')}</p>}
      {run.error && (
        <p role="alert" className="text-sm text-red-600" data-testid="run-error">
          {t(errorKey(run.error, RUN_ERRORS))}
        </p>
      )}
    </form>
  );
}
