# Segurança (Fase 1)

## O que está implementado

| Tema        | Controle                                                                                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Senhas      | PBKDF2-SHA256 100k + salt + pepper (segredo fora do código), comparação em tempo constante, tempo equalizado para e-mail inexistente                                                                        |
| Sessão      | Cookie `__Host-` `HttpOnly; Secure; SameSite=Lax`, só hash SHA-256 no banco, rotação com tolerância, expiração 14 dias, logout invalida no servidor                                                         |
| CSRF        | SameSite=Lax **e** verificação de `Origin` (igual à origem da requisição ou a `APP_ORIGINS`); sem `Origin`, exige `Sec-Fetch-Site` `same-origin`/`none`; `Content-Type: application/json` obrigatório (415) |
| Anti-bot    | Turnstile no cadastro/login; sem configuração em produção ⇒ 503 (fail-closed); falha de rede na verificação ⇒ recusa                                                                                        |
| Autorização | Consultas sempre a partir do usuário da sessão; não-membro ⇒ 404; `requireRole`                                                                                                                             |
| Abuso       | Rate limit por IP e por e-mail (D1), caps globais diários, limite de tamanho de corpo (413)                                                                                                                 |
| Segredos    | Nenhum segredo no frontend, em `localStorage` ou no repositório. `.dev.vars` ignorado pelo git; testes geram segredos aleatórios a cada execução                                                            |
| Cabeçalhos  | API: `nosniff`, `no-store`, `CSP default-src 'none'`, HSTS, `Referrer-Policy: no-referrer`, CORP same-origin. Web (`_headers`): CSP sem `unsafe-inline`, `frame-ancestors 'none'`                           |
| Erros       | Validação devolve só caminho e código do campo, nunca valores                                                                                                                                               |
| Cobrança    | Nenhuma rota de cobrança; teste garante 404                                                                                                                                                                 |

## Limitações e trade-offs conhecidos

1. **PBKDF2 vs. 10 ms de CPU (risco aberto).** O Workers limita PBKDF2 a 100.000 iterações. Medido em workerd local: ~15 ms de relógio por derivação, acima dos 10 ms de CPU do plano free. Não se sabe se a derivação nativa conta como CPU no ambiente real; **só um Worker implantado responde**. Alternativas (derivação no cliente) desviam do §8 e exigem aprovação.
2. **Enumeração de e-mails no cadastro.** `409 email_taken` revela se um e-mail existe. Mitigado por rate limit + Turnstile; a alternativa (e-mail de confirmação) exige envio de e-mail, que está fora do free tier.
3. **Indisponibilidade por abuso.** Sem cobrança por excesso, um atacante pode esgotar os 100 mil req/dia e derrubar o serviço (nunca gera fatura). Caps internos reduzem, não eliminam.
4. **Sem verificação de e-mail e sem recuperação de senha** nesta fase (dependem de e-mail).
5. **Auditoria de bloqueios ausente** por decisão (orçamento de escrita).
6. **Dependências de desenvolvimento** com 11 avisos moderados (`esbuild` via `drizzle-kit`, `minimatch` em lint). Produção: 0 vulnerabilidades (`npm audit --omit=dev`).
