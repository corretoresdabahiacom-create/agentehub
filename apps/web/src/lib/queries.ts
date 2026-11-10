import type { CatalogQuery, ReviewInput } from '@agenthub/shared';
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
