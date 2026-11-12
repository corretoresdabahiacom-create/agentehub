import type {
  CreateInviteInput,
  InviteAccepted,
  InviteCreated,
  InvitePreview,
  InviteView,
  LibraryItem,
  MemberView,
  WorkspaceExecutionItem,
  WorkspaceUsage,
  AgentBody,
  AgentDetail,
  CreateExecutionInput,
  ExecutionDetail,
  ExecutionListResponse,
  ExecutionStatusName,
  MyAgentDetail,
  MyAgentSummary,
  PendingApprovalItem,
  PublishInput,
  TestRunResponse,
  ToolsResponse,
  ValidateResponse,
  ExecutionInput,
  CatalogQuery,
  CatalogResponse,
  CategoryWithCount,
  LoginInput,
  MeResponse,
  PublicConfigResponse,
  ReviewInput,
  ReviewsResponse,
  SignupInput,
} from '@agenthub/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      // Same-origin: o cookie HttpOnly de sessão vai sozinho. Nada de token em JS/localStorage.
      credentials: 'same-origin',
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, 'network', 'network');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string; details?: unknown };
  } | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'generic',
      data?.error?.message ?? 'error',
      data?.error?.details,
    );
  }
  return data as T;
}

export const api = {
  config: () => request<PublicConfigResponse>('/api/config'),
  me: async (): Promise<MeResponse | null> => {
    try {
      return await request<MeResponse>('/api/auth/me');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },
  signup: (input: SignupInput) =>
    request<MeResponse>('/api/auth/signup', { method: 'POST', body: JSON.stringify(input) }),
  login: (input: LoginInput) =>
    request<MeResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),

  // ---- marketplace
  categories: () => request<{ categories: CategoryWithCount[] }>('/api/categories'),
  catalog: (q: Partial<CatalogQuery>) => request<CatalogResponse>(`/api/agents${toQuery(q)}`),
  agent: (slug: string) => request<AgentDetail>(`/api/agents/${encodeURIComponent(slug)}`),
  reviews: (slug: string, page = 1) =>
    request<ReviewsResponse>(`/api/agents/${encodeURIComponent(slug)}/reviews?page=${page}`),
  install: (slug: string, workspaceId: string) =>
    request<{ installed: true }>(`/api/agents/${encodeURIComponent(slug)}/install`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    }),
  uninstall: (slug: string, workspaceId: string) =>
    request<{ installed: false }>(
      `/api/agents/${encodeURIComponent(slug)}/install/${encodeURIComponent(workspaceId)}`,
      { method: 'DELETE' },
    ),
  favorite: (slug: string, on: boolean) =>
    request<{ favorited: boolean }>(`/api/agents/${encodeURIComponent(slug)}/favorite`, {
      method: on ? 'PUT' : 'DELETE',
    }),
  saveReview: (slug: string, input: ReviewInput) =>
    request<unknown>(`/api/agents/${encodeURIComponent(slug)}/review`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteReview: (slug: string) =>
    request<unknown>(`/api/agents/${encodeURIComponent(slug)}/review`, { method: 'DELETE' }),

  // ---- construtor
  tools: () => request<ToolsResponse>('/api/tools'),
  myAgents: () => request<{ agents: MyAgentSummary[] }>('/api/my/agents'),
  myAgent: (id: string) => request<MyAgentDetail>(`/api/my/agents/${encodeURIComponent(id)}`),
  createAgent: (body: AgentBody) =>
    request<MyAgentDetail>('/api/my/agents', { method: 'POST', body: JSON.stringify(body) }),
  updateAgent: (id: string, body: Omit<AgentBody, 'workspaceId'>) =>
    request<MyAgentDetail>(`/api/my/agents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  validateAgent: (id: string) =>
    request<ValidateResponse>(`/api/my/agents/${encodeURIComponent(id)}/validate`, {
      method: 'POST',
      body: '{}',
    }),
  testAgent: (id: string, input: ExecutionInput) =>
    request<TestRunResponse>(`/api/my/agents/${encodeURIComponent(id)}/test-run`, {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),
  publishAgent: (id: string, body: PublishInput) =>
    request<MyAgentDetail>(`/api/my/agents/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  archiveAgent: (id: string) =>
    request<{ archived: true }>(`/api/my/agents/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
      body: '{}',
    }),

  // ---- execuções
  runAgent: (body: CreateExecutionInput) =>
    request<ExecutionDetail>('/api/executions', { method: 'POST', body: JSON.stringify(body) }),
  executions: (q: { status?: ExecutionStatusName; page?: number }) =>
    request<ExecutionListResponse>(`/api/executions${toQuery(q)}`),
  execution: (id: string) => request<ExecutionDetail>(`/api/executions/${encodeURIComponent(id)}`),
  approvals: () => request<{ approvals: PendingApprovalItem[] }>('/api/approvals'),
  decide: (id: string, action: 'approve' | 'reject', body: Record<string, unknown>) =>
    request<ExecutionDetail>(`/api/executions/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  cancelExecution: (id: string) =>
    request<ExecutionDetail>(`/api/executions/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: '{}',
    }),
  retryExecution: (id: string) =>
    request<ExecutionDetail>(`/api/executions/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
      body: '{}',
    }),
  // ---- empresas (Fase 4)
  createCompany: (name: string) =>
    request<{ memberships: MeResponse['memberships'] }>('/api/organizations', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  createWorkspace: (orgId: string, name: string) =>
    request<{ memberships: MeResponse['memberships'] }>(
      `/api/organizations/${encodeURIComponent(orgId)}/workspaces`,
      { method: 'POST', body: JSON.stringify({ name }) },
    ),
  invitePreview: (token: string) =>
    request<InvitePreview>(`/api/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) =>
    request<InviteAccepted>(`/api/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      body: '{}',
    }),
  invites: (ws: string) =>
    request<{ invites: InviteView[] }>(`/api/workspaces/${encodeURIComponent(ws)}/invites`),
  createInvite: (ws: string, body: CreateInviteInput) =>
    request<InviteCreated>(`/api/workspaces/${encodeURIComponent(ws)}/invites`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  revokeInvite: (ws: string, id: string) =>
    request<{ revoked: true }>(
      `/api/workspaces/${encodeURIComponent(ws)}/invites/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),
  members: (ws: string) =>
    request<{ members: MemberView[] }>(`/api/workspaces/${encodeURIComponent(ws)}/members`),
  changeRole: (ws: string, userId: string, role: 'admin' | 'member') =>
    request<unknown>(
      `/api/workspaces/${encodeURIComponent(ws)}/members/${encodeURIComponent(userId)}`,
      { method: 'PATCH', body: JSON.stringify({ role }) },
    ),
  removeMember: (ws: string, userId: string) =>
    request<{ removed: true }>(
      `/api/workspaces/${encodeURIComponent(ws)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    ),
  setQuota: (ws: string, userId: string, executionsPerDay: number | null) =>
    request<unknown>(
      `/api/workspaces/${encodeURIComponent(ws)}/members/${encodeURIComponent(userId)}/quota`,
      { method: 'PUT', body: JSON.stringify({ executionsPerDay }) },
    ),
  usage: (ws: string) => request<WorkspaceUsage>(`/api/workspaces/${encodeURIComponent(ws)}/usage`),
  library: (ws: string) =>
    request<{ items: LibraryItem[] }>(`/api/workspaces/${encodeURIComponent(ws)}/library`),
  workspaceRuns: (ws: string, q: { status?: string; userId?: string; page?: number }) =>
    request<{
      executions: WorkspaceExecutionItem[];
      page: number;
      pageSize: number;
      total: number;
    }>(`/api/workspaces/${encodeURIComponent(ws)}/executions${toQuery(q)}`),
};

/** Monta a query string omitindo valores vazios/padrão (a API rejeita string vazia em `category`). */
export function toQuery(q: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Chave i18n para um erro de API (cai em errors.generic quando o código é desconhecido). */
export function errorKey(err: unknown, known: readonly string[]): string {
  if (err instanceof ApiError && known.includes(err.code)) return `errors.${err.code}`;
  return 'errors.generic';
}
