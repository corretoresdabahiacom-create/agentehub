import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
