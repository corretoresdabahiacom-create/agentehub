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

1. **PBKDF2 vs. 10 ms de CPU (risco aberto; decisão no ADR 0002: manter, medir no deploy, contingência sem custo).** O Workers limita PBKDF2 a 100.000 iterações. Medido em workerd local: ~15 ms de relógio por derivação, acima dos 10 ms de CPU do plano free. Não se sabe se a derivação nativa conta como CPU no ambiente real; **só um Worker implantado responde**. Alternativas (derivação no cliente) desviam do §8 e exigem aprovação.
2. **Enumeração de e-mails no cadastro.** `409 email_taken` revela se um e-mail existe. Mitigado por rate limit + Turnstile; a alternativa (e-mail de confirmação) exige envio de e-mail, que está fora do free tier.
3. **Indisponibilidade por abuso.** Sem cobrança por excesso, um atacante pode esgotar os 100 mil req/dia e derrubar o serviço (nunca gera fatura). Caps internos reduzem, não eliminam.
4. **Sem verificação de e-mail e sem recuperação de senha** nesta fase (dependem de e-mail).
5. **Auditoria de bloqueios ausente** por decisão (orçamento de escrita).
6. **Dependências de desenvolvimento** com 11 avisos moderados (`esbuild` via `drizzle-kit`, `minimatch` em lint). Produção: 0 vulnerabilidades (`npm audit --omit=dev`).

## Marketplace (Fase 2)

| Tema                       | Controle                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leitura pública            | Catálogo, detalhe e avaliações são públicos e só expõem agentes `public` + `published`. Nada de dados de usuário: avaliações são anônimas                                  |
| Injeção                    | Todo SQL usa parâmetros ligados; o texto de busca tem `%`, `_` e `\` escapados e tamanho máximo de 80; ordenação por tabela fixa (nunca texto do cliente)                  |
| XSS                        | Nome, descrição e comentários são renderizados como texto pelo React; o CSP `script-src 'self'` e `style-src 'self'` continua válido (nenhum estilo inline foi adicionado) |
| Autorização                | Instalar exige ser membro do workspace (404 caso contrário); desinstalar/favoritar/avaliar escopam sempre pelo usuário da sessão                                           |
| Integridade das avaliações | Qualificação (instalação + execução concluída ≤ 90 dias) validada no servidor; a UI só reflete a resposta                                                                  |
| Abuso                      | Escritas do marketplace limitadas a 60 por 10 min por usuário (D1, mesma técnica do login); CSRF por Origin em todo método com efeito colateral                            |

Riscos conhecidos: leituras públicas não têm rate limit próprio (uma escrita por leitura queimaria o orçamento do D1); o teto de 100.000 requisições/dia do Workers é a barreira. Cada listagem lê poucas linhas indexadas, bem abaixo dos 5 milhões de leituras/dia do D1.
