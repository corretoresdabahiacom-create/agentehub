import type {
  CreateInviteInput,
  AgentBody,
  CatalogQuery,
  CreateExecutionInput,
  ExecutionInput,
  ExecutionStatusName,
  PublishInput,
  ReviewInput,
} from '@agenthub/shared';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from './api';

export const keys = { me: ['me'] as const, config: ['config'] as const };

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: 60_000, retry: false });
}

export function useConfig() {
  return useQuery({ queryKey: keys.config, queryFn: api.config, staleTime: 60_000, retry: 1 });
}

/** Esvazia TODO o cache: nada de dados do usuário anterior fica em memória. */
export function useClearSession() {
  const qc = useQueryClient();
  return () => {
    qc.setQueryData(keys.me, null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  };
}

export function useLogout() {
  return useMutation({ mutationFn: api.logout });
}

// ---------------------------------------------------------------- marketplace

/** Toda chave de dados do marketplace começa com 'agents' (invalidação em bloco após ações). */
export function useCategories() {
  return useQuery({
    queryKey: ['agents', 'categories'],
    queryFn: api.categories,
    staleTime: 60_000,
  });
}

export function useCatalog(q: Partial<CatalogQuery>) {
  return useQuery({
    queryKey: ['agents', 'catalog', q],
    queryFn: () => api.catalog(q),
    placeholderData: keepPreviousData,
  });
}

export function useAgent(slug: string) {
  return useQuery({
    queryKey: ['agents', 'detail', slug],
    queryFn: () => api.agent(slug),
    retry: false,
  });
}

export function useReviews(slug: string) {
  return useQuery({ queryKey: ['agents', 'reviews', slug], queryFn: () => api.reviews(slug) });
}

/** Mutação de marketplace: ao concluir, recarrega catálogo, detalhe e avaliações. */
function useAgentMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export const useInstall = (slug: string) =>
  useAgentMutation((workspaceId: string) => api.install(slug, workspaceId));
export const useUninstall = (slug: string) =>
  useAgentMutation((workspaceId: string) => api.uninstall(slug, workspaceId));
export const useFavorite = (slug: string) =>
  useAgentMutation((on: boolean) => api.favorite(slug, on));
export const useSaveReview = (slug: string) =>
  useAgentMutation((input: ReviewInput) => api.saveReview(slug, input));
export const useDeleteReview = (slug: string) => useAgentMutation(() => api.deleteReview(slug));

// -------------------------------------------------------- construtor e execuções

export const useTools = () =>
  useQuery({ queryKey: ['builder', 'tools'], queryFn: api.tools, staleTime: 5 * 60_000 });
export const useMyAgents = () => useQuery({ queryKey: ['builder', 'list'], queryFn: api.myAgents });
export const useMyAgent = (id: string | undefined) =>
  useQuery({
    queryKey: ['builder', 'detail', id],
    queryFn: () => api.myAgent(id ?? ''),
    enabled: Boolean(id),
    retry: false,
  });

function useBuilderMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['builder'] });
      void qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}
export const useCreateAgent = () => useBuilderMutation((b: AgentBody) => api.createAgent(b));
export const useUpdateAgent = (id: string) =>
  useBuilderMutation((b: Omit<AgentBody, 'workspaceId'>) => api.updateAgent(id, b));
export const useValidateAgent = (id: string) =>
  useMutation({ mutationFn: () => api.validateAgent(id) });
export const useTestAgent = (id: string) =>
  useMutation({ mutationFn: (input: ExecutionInput) => api.testAgent(id, input) });
export const usePublishAgent = (id: string) =>
  useBuilderMutation((b: PublishInput) => api.publishAgent(id, b));
export const useArchiveAgent = (id: string) => useBuilderMutation(() => api.archiveAgent(id));

/** Chaves de execução começam com 'runs' (invalidação em bloco). */
export const useExecutions = (status?: ExecutionStatusName, page = 1) =>
  useQuery({
    queryKey: ['runs', 'list', status ?? 'all', page],
    queryFn: () => api.executions({ status, page }),
  });
export const useApprovals = () =>
  useQuery({ queryKey: ['runs', 'approvals'], queryFn: api.approvals });
export const useExecution = (id: string) =>
  useQuery({
    queryKey: ['runs', 'detail', id],
    queryFn: () => api.execution(id),
    retry: false,
  });

function useRunMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  });
}
export const useRunAgent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateExecutionInput) => api.runAgent(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  });
};
export const useDecide = (id: string) =>
  useRunMutation((v: { action: 'approve' | 'reject'; body: Record<string, unknown> }) =>
    api.decide(id, v.action, v.body),
  );
export const useCancelExecution = (id: string) => useRunMutation(() => api.cancelExecution(id));
export const useRetryExecution = (id: string) => useRunMutation(() => api.retryExecution(id));

// ------------------------------------------------------------------- empresas

/** Chaves de equipe começam com 'teams' (invalidação em bloco). */
function useTeamMutation<V, R>(fn: (v: V) => Promise<R>, alsoMe = false) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['teams'] });
      if (alsoMe) void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}
export const useCreateCompany = () =>
  useTeamMutation((name: string) => api.createCompany(name), true);
export const useCreateWorkspace = (orgId: string) =>
  useTeamMutation((name: string) => api.createWorkspace(orgId, name), true);
export const useInvitePreview = (token: string) =>
  useQuery({
    queryKey: ['teams', 'invite', token],
    queryFn: () => api.invitePreview(token),
    retry: false,
  });
export const useAcceptInvite = (token: string) =>
  useTeamMutation(() => api.acceptInvite(token), true);
export const useInvites = (ws: string, enabled: boolean) =>
  useQuery({ queryKey: ['teams', ws, 'invites'], queryFn: () => api.invites(ws), enabled });
export const useCreateInvite = (ws: string) =>
  useTeamMutation((b: CreateInviteInput) => api.createInvite(ws, b));
export const useRevokeInvite = (ws: string) =>
  useTeamMutation((id: string) => api.revokeInvite(ws, id));
export const useMembers = (ws: string, enabled: boolean) =>
  useQuery({ queryKey: ['teams', ws, 'members'], queryFn: () => api.members(ws), enabled });
export const useChangeRole = (ws: string) =>
  useTeamMutation((v: { userId: string; role: 'admin' | 'member' }) =>
    api.changeRole(ws, v.userId, v.role),
  );
export const useRemoveMember = (ws: string) =>
  useTeamMutation((userId: string) => api.removeMember(ws, userId), true);
export const useSetQuota = (ws: string) =>
  useTeamMutation((v: { userId: string; value: number | null }) =>
    api.setQuota(ws, v.userId, v.value),
  );
export const useUsage = (ws: string) =>
  useQuery({ queryKey: ['teams', ws, 'usage'], queryFn: () => api.usage(ws) });
export const useLibrary = (ws: string) =>
  useQuery({ queryKey: ['teams', ws, 'library'], queryFn: () => api.library(ws) });
export const useWorkspaceRuns = (ws: string, enabled: boolean, userId?: string, page = 1) =>
  useQuery({
    queryKey: ['teams', ws, 'runs', userId ?? 'all', page],
    queryFn: () => api.workspaceRuns(ws, { userId, page }),
    enabled,
  });
