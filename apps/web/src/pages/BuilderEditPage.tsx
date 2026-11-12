import { TOOL_META, type AgentBody, type ExecutionInput, type Issue } from '@agenthub/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { RunForm } from '../components/RunForm';
import { ApiError, errorKey } from '../lib/api';
import { RUN_ERRORS } from '../lib/errors';
import { useOnline } from '../lib/online';
import {
  useArchiveAgent,
  useCreateAgent,
  useMe,
  useMyAgent,
  usePublishAgent,
  useTestAgent,
  useTools,
  useUpdateAgent,
  useValidateAgent,
} from '../lib/queries';
import { btnOutline, btnPrimary, card, field } from '../lib/ui';

const FORMATS = ['markdown', 'text', 'json'] as const;
type Limits = {
  maxInputChars: number;
  maxSteps: number;
  maxDurationMs: number;
  maxAttempts: number;
  requireApproval: boolean;
};
type ToolState = Record<string, Record<string, unknown>>;
const TOOL_CONFIG_FIELDS: Record<
  string,
  Array<{ name: string; kind: 'number' | 'text'; min?: number; max?: number; def: unknown }>
> = {
  'text.keywords': [{ name: 'n', kind: 'number', min: 1, max: 20, def: 8 }],
  'text.summarize': [{ name: 'sentences', kind: 'number', min: 1, max: 10, def: 3 }],
  'text.template': [{ name: 'template', kind: 'text', def: '' }],
};

export default function BuilderEditPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const online = useOnline();
  const me = useMe();
  const tools = useTools();
  const existing = useMyAgent(isNew ? undefined : id);
  const agentId = isNew ? '' : (id ?? '');
  const create = useCreateAgent();
  const update = useUpdateAgent(agentId);
  const validate = useValidateAgent(agentId);
  const test = useTestAgent(agentId);
  const publish = usePublishAgent(agentId);
  const archive = useArchiveAgent(agentId);

  const [workspaceId, setWorkspaceId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [objective, setObjective] = useState('');
  const [instructions, setInstructions] = useState('');
  const [outputFormat, setOutputFormat] = useState<(typeof FORMATS)[number]>('markdown');
  const [selected, setSelected] = useState<ToolState>({});
  const [limits, setLimits] = useState<Limits | null>(null);
  const [visibility, setVisibility] = useState<'private' | 'workspace' | 'public'>('private');
  const [confirmPublic, setConfirmPublic] = useState(false);
  const [testText, setTestText] = useState('');
  const [testTopic, setTestTopic] = useState('');
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [loadedKey, setLoadedKey] = useState('');

  // Carrega o agente existente uma vez por versão carregada.
  const data = existing.data;
  useEffect(() => {
    if (!data) return;
    const key = `${data.id}:${data.version}:${data.updatedAt}`;
    if (key === loadedKey) return;
    setLoadedKey(key);
    setName(data.name);
    setDescription(data.description);
    setObjective(data.objective);
    setInstructions(data.instructions);
    setOutputFormat(data.outputFormat);
    setSelected(Object.fromEntries(data.tools.map((x) => [x.key, x.config])));
    setLimits(data.limits as Limits);
    if (data.visibility === 'public') setVisibility('public');
    else if (data.visibility === 'workspace') setVisibility('workspace');
  }, [data, loadedKey]);
  useEffect(() => {
    if (isNew && !limits && tools.data) setLimits({ ...tools.data.defaults });
  }, [isNew, limits, tools.data]);

  const memberships = me.data?.memberships ?? [];
  const ws = workspaceId || memberships[0]?.workspaceId || '';

  if (!isNew && existing.isPending) return <p aria-busy="true">…</p>;
  if (!isNew && (existing.error || !data)) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">
          {existing.error instanceof ApiError && existing.error.status === 404
            ? t('builder.notFound')
            : t('errors.generic')}
        </h1>
        <Link to="/builder" className="text-brand-600 underline">
          {t('builder.back')}
        </Link>
      </div>
    );
  }
  if (!limits || !tools.data) return <p aria-busy="true">…</p>;

  const body = (): Omit<AgentBody, 'workspaceId'> => ({
    name,
    description,
    objective,
    instructions,
    outputFormat,
    tools: Object.entries(selected).map(([key, config]) => ({ key, config })),
    limits,
  });
  const toggleTool = (key: string, on: boolean) =>
    setSelected((s) => {
      const next = { ...s };
      if (!on) {
        delete next[key];
        return next;
      }
      const cfg: Record<string, unknown> = {};
      for (const f of TOOL_CONFIG_FIELDS[key] ?? []) if (f.def !== '') cfg[f.name] = f.def;
      next[key] = cfg;
      return next;
    });
  const setCfg = (key: string, k: string, v: unknown) =>
    setSelected((s) => ({ ...s, [key]: { ...(s[key] ?? {}), [k]: v } }));
  const setLimit = <K extends keyof Limits>(k: K, v: Limits[K]) => setLimits({ ...limits, [k]: v });

  const save = () => {
    setIssues(null);
    if (isNew) {
      create.mutate(
        { ...body(), workspaceId: ws },
        { onSuccess: (a) => void navigate(`/builder/${a.id}`, { replace: true }) },
      );
    } else {
      update.mutate(body());
    }
  };
  const runValidate = () => validate.mutate(undefined, { onSuccess: (r) => setIssues(r.issues) });
  const runTest = () => {
    const input: ExecutionInput = {
      ...(testText ? { text: testText } : {}),
      ...(testTopic ? { topic: testTopic } : {}),
      locale: 'en',
    };
    test.mutate(input);
  };
  const doPublish = () =>
    publish.mutate(
      { visibility, ...(visibility === 'public' ? { confirmPublic } : {}) },
      {
        onError: (err) => {
          const details =
            err instanceof ApiError ? (err.details as { issues?: Issue[] } | undefined) : undefined;
          if (details?.issues) setIssues(details.issues);
        },
      },
    );
  const err =
    create.error ?? update.error ?? validate.error ?? test.error ?? publish.error ?? archive.error;
  const saving = create.isPending || update.isPending;
  const published = Boolean(data?.hasPublishedVersion);
  const agentMembership = me.data?.memberships.find((m) => m.workspaceId === data?.workspaceId);
  const canShareWorkspace =
    agentMembership?.organizationKind === 'company' &&
    (agentMembership.role === 'owner' || agentMembership.role === 'admin');
  const canPublish = !isNew && data?.versionStatus === 'draft';
  const issueText = (i: Issue) =>
    t(`issues.${i.code}`, { defaultValue: i.code, detail: i.detail ?? '' });

  return (
    <div className="space-y-6">
      <nav className="text-sm">
        <Link to="/builder" className="text-brand-600 underline">
          {t('builder.back')}
        </Link>
      </nav>
      <h1 className="text-2xl font-bold">{isNew ? t('builder.new') : t('builder.edit')}</h1>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        data-testid="builder-form"
      >
        {isNew && memberships.length > 1 && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('market.workspace')}</span>
            <select className={field} value={ws} onChange={(e) => setWorkspaceId(e.target.value)}>
              {memberships.map((m) => (
                <option key={m.workspaceId} value={m.workspaceId}>
                  {m.workspaceName} — {m.organizationName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('builder.name')}</span>
          <input
            className={field}
            value={name}
            maxLength={80}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('builder.description')}</span>
          <textarea
            className={field}
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('builder.objective')}</span>
          <input
            className={field}
            value={objective}
            maxLength={500}
            onChange={(e) => setObjective(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('builder.instructions')}</span>
          <textarea
            className={`${field} min-h-28`}
            value={instructions}
            maxLength={4000}
            onChange={(e) => setInstructions(e.target.value)}
          />
          <span className="text-xs text-[var(--text-muted)]">{t('builder.instructionsHint')}</span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('builder.outputFormat')}</span>
          <select
            className={field}
            value={outputFormat}
            onChange={(e) => setOutputFormat(e.target.value as typeof outputFormat)}
          >
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <fieldset className={`${card} space-y-3`}>
          <legend className="px-1 text-sm font-medium">{t('builder.tools')}</legend>
          <p className="text-xs text-[var(--text-muted)]">{t('builder.toolsHint')}</p>
          {TOOL_META.map((tool) => {
            const on = tool.key in selected;
            return (
              <div key={tool.key} className="space-y-1">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => toggleTool(tool.key, e.target.checked)}
                  />
                  <span>
                    <span className="font-mono">{tool.key}</span> —{' '}
                    {t(`builder.toolDesc.${tool.key}`)}
                    {tool.approval === 'always' && (
                      <em className="ml-1 text-amber-800">({t('builder.needsApproval')})</em>
                    )}
                    {tool.requiresAi && (
                      <em className="ml-1 text-amber-800">({t('builder.needsAi')})</em>
                    )}
                  </span>
                </label>
                {on &&
                  (TOOL_CONFIG_FIELDS[tool.key] ?? []).map((f) => (
                    <label key={f.name} className="ml-6 block text-xs">
                      <span className="mr-2">{t(`builder.cfg.${f.name}`)}</span>
                      {f.kind === 'number' ? (
                        <input
                          type="number"
                          className="w-20 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1"
                          min={f.min}
                          max={f.max}
                          value={Number(selected[tool.key]?.[f.name] ?? f.def)}
                          onChange={(e) => setCfg(tool.key, f.name, Number(e.target.value))}
                        />
                      ) : (
                        <textarea
                          className={`${field} mt-1`}
                          maxLength={4000}
                          value={String(selected[tool.key]?.[f.name] ?? '')}
                          onChange={(e) => setCfg(tool.key, f.name, e.target.value)}
                        />
                      )}
                    </label>
                  ))}
              </div>
            );
          })}
        </fieldset>

        <fieldset className={`${card} grid gap-3 sm:grid-cols-2`}>
          <legend className="px-1 text-sm font-medium">{t('builder.limits')}</legend>
          {(['maxInputChars', 'maxSteps', 'maxDurationMs', 'maxAttempts'] as const).map((k) => {
            const r = tools.data.limits[k];
            return (
              <label key={k} className="block text-sm">
                <span className="mb-1 block">{t(`builder.limit.${k}`)}</span>
                <input
                  type="number"
                  className={field}
                  min={r.min}
                  max={r.max}
                  value={limits[k]}
                  onChange={(e) => setLimit(k, Number(e.target.value))}
                />
                <span className="text-xs text-[var(--text-muted)]">
                  {r.min}–{r.max}
                </span>
              </label>
            );
          })}
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={limits.requireApproval}
              onChange={(e) => setLimit('requireApproval', e.target.checked)}
            />
            {t('builder.limit.requireApproval')}
          </label>
        </fieldset>

        <button
          type="submit"
          className={btnPrimary}
          disabled={!online || saving || !name.trim() || (isNew && !ws)}
        >
          {t('builder.save')}
        </button>
      </form>

      {!isNew && data && (
        <>
          <section className={`${card} space-y-3`} aria-labelledby="val-title">
            <h2 id="val-title" className="font-semibold">
              {t('builder.validate')}
            </h2>
            <button
              type="button"
              className={btnOutline}
              disabled={!online || validate.isPending}
              onClick={runValidate}
            >
              {t('builder.validateAction')}
            </button>
            {issues && (
              <div data-testid="issues">
                {issues.length === 0 ? (
                  <p className="text-sm text-green-700" data-testid="valid-ok">
                    {t('builder.valid')}
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {issues.map((i, n) => (
                      <li
                        key={n}
                        className={i.severity === 'error' ? 'text-red-700' : 'text-amber-800'}
                        data-testid={`issue-${i.code}`}
                      >
                        <strong>{t(`builder.severity.${i.severity}`)}:</strong> {issueText(i)}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-[var(--text-muted)]">{t('builder.heuristic')}</p>
              </div>
            )}
          </section>

          <section className={`${card} space-y-3`} aria-labelledby="test-title">
            <h2 id="test-title" className="font-semibold">
              {t('builder.test')}
            </h2>
            <p className="text-xs text-[var(--text-muted)]">{t('builder.testHint')}</p>
            <textarea
              className={field}
              aria-label={t('run.text')}
              placeholder={t('run.text')}
              value={testText}
              maxLength={limits.maxInputChars}
              onChange={(e) => setTestText(e.target.value)}
            />
            <input
              className={field}
              aria-label={t('run.topic')}
              placeholder={t('run.topic')}
              value={testTopic}
              maxLength={200}
              onChange={(e) => setTestTopic(e.target.value)}
            />
            <button
              type="button"
              className={btnOutline}
              disabled={!online || test.isPending}
              onClick={runTest}
            >
              {t('builder.testAction')}
            </button>
            {test.data && (
              <div data-testid="test-result" className="space-y-2 text-sm">
                <p>
                  {t('builder.testStatus')}: <strong>{t(`runs.status.${test.data.status}`)}</strong>
                  {test.data.error ? ` (${test.data.error})` : ''}
                </p>
                {test.data.output && (
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--surface-muted)] p-3">
                    {test.data.output.content}
                  </pre>
                )}
              </div>
            )}
          </section>

          <section className={`${card} space-y-3`} aria-labelledby="pub-title">
            <h2 id="pub-title" className="font-semibold">
              {t('builder.publish')}
            </h2>
            <p className="text-sm text-[var(--text-muted)]">
              {t('builder.currentState', {
                status: t(`builder.status.${data.status}`),
                visibility: t(`builder.visibility.${data.visibility}`),
                version: data.version,
              })}
            </p>
            {canPublish ? (
              <>
                <label className="block text-sm">
                  <span className="mb-1 block">{t('builder.visibilityLabel')}</span>
                  <select
                    className={field}
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value as typeof visibility)}
                    disabled={data.visibility === 'public'}
                  >
                    <option value="private">{t('builder.visibility.private')}</option>
                    {canShareWorkspace && (
                      <option value="workspace">{t('builder.visibility.workspace')}</option>
                    )}
                    <option value="public">{t('builder.visibility.public')}</option>
                  </select>
                </label>
                <p className="text-xs text-[var(--text-muted)]">
                  {canShareWorkspace
                    ? t('builder.workspaceVisibilityHint')
                    : t('builder.workspaceVisibilityCompany')}
                </p>
                {visibility === 'public' && (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={confirmPublic}
                      onChange={(e) => setConfirmPublic(e.target.checked)}
                    />
                    <span>{t('builder.confirmPublic')}</span>
                  </label>
                )}
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={
                    !online || publish.isPending || (visibility === 'public' && !confirmPublic)
                  }
                  onClick={doPublish}
                >
                  {t('builder.publishAction')}
                </button>
              </>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">{t('builder.nothingToPublish')}</p>
            )}
            {publish.isSuccess && (
              <p className="text-sm text-green-700" data-testid="published-note">
                {t('builder.published')}
              </p>
            )}
            <button
              type="button"
              className={btnOutline}
              disabled={!online || archive.isPending}
              onClick={() =>
                archive.mutate(undefined, { onSuccess: () => void navigate('/builder') })
              }
            >
              {t('builder.archive')}
            </button>
          </section>

          {published && (
            <RunForm
              slug={data.slug}
              toolKeys={data.tools.map((x) => x.key)}
              maxInputChars={Number((data.limits as Limits).maxInputChars) || 10_000}
              requiresApproval={
                (data.limits as Limits).requireApproval ||
                data.tools.some(
                  (x) => TOOL_META.find((m) => m.key === x.key)?.approval === 'always',
                )
              }
              requiresAi={data.tools.some(
                (x) => TOOL_META.find((m) => m.key === x.key)?.requiresAi,
              )}
              workspaces={memberships
                .filter((m) => !data.workspaceId || m.workspaceId === data.workspaceId)
                .map((m) => ({
                  id: m.workspaceId,
                  label: `${m.workspaceName} — ${m.organizationName}`,
                }))}
            />
          )}
        </>
      )}

      {err && (
        <p role="alert" className="text-sm text-red-600" data-testid="builder-error">
          {t(errorKey(err, RUN_ERRORS))}
        </p>
      )}
    </div>
  );
}
