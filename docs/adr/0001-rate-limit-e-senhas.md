# ADR 0001 — Rate limit em D1 e senhas com PBKDF2

**Status:** aceita (Fase 1). **Contexto:** o usuário delegou as decisões 3 e 4 (“decida o melhor e que seja grátis”).

## Rate limit

- **Escolha:** contador de janela fixa em D1 (`rate_limit_counters`), upsert condicional que não escreve quando o limite já foi atingido.
- **Por quê:** KV free permite 1.000 escritas/dia; um contador por requisição o esgotaria. D1 tem 100 mil escritas/dia e bloqueios não consomem escrita.
- **Custo:** 1 escrita por tentativa permitida em endpoints sensíveis; janela fixa admite rajada de até 2× o limite na virada.

## Senhas

- **Escolha:** PBKDF2-SHA256, 100.000 iterações, salt por usuário, pepper por HMAC.
- **Por quê:** é o que a Web Crypto do Workers oferece nativamente (sem dependência). bcryptjs em JS puro excederia o CPU. Argon2/scrypt não são nativos.
- **Risco:** ~15 ms de relógio local vs. 10 ms de CPU free; validar no deploy. `needsRehash` permite trocar de parâmetros sem migração forçada.
- **Alternativas rejeitadas por ora:** derivação no cliente (desvia do §8), plano pago (viola R1).
