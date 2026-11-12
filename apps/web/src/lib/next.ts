/** Destino pós-login vindo de `?next=`: só caminho interno (evita open redirect). */
export function safeNext(search: string): string | null {
  const v = new URLSearchParams(search).get('next');
  return v && v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') ? v : null;
}
