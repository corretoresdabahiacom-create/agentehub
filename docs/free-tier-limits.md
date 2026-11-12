# Limites de free tier — Cloudflare

Verificado em **2026-11-09** nas páginas oficiais em `developers.cloudflare.com`. Estes limites mudam; reverificar antes de cada fase que habilite um recurso novo (R2).

## 1. Limites vigentes (plano Workers Free / Free)

| Recurso                             | Limite free                              | Se exceder                                      | Fonte                                                                        |
| ----------------------------------- | ---------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Workers: requisições                | 100.000 / dia (reset 00:00 UTC)          | Erro 1027 (sem cobrança)                        | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Workers: CPU por requisição HTTP    | **10 ms**                                | Requisição abortada                             | idem                                                                         |
| Workers: subrequests por requisição | 50                                       | Erro                                            | idem                                                                         |
| Workers: memória por isolate        | 128 MB                                   | Erro                                            | idem                                                                         |
| Workers: tamanho do Worker          | 64 MiB                                   | Deploy falha                                    | idem                                                                         |
| Workers: Cron Triggers              | 5 por conta, 10 ms CPU cada              | n/a                                             | idem                                                                         |
| Workers: variáveis de ambiente      | 64 por Worker, 5 KB cada                 | n/a                                             | idem                                                                         |
| D1: linhas lidas                    | 5.000.000 / dia                          | Queries bloqueadas até 00:00 UTC (sem cobrança) | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)         |
| D1: linhas escritas                 | **100.000 / dia**                        | idem                                            | idem                                                                         |
| D1: armazenamento                   | 5 GB total; 10 bancos                    | Inserts/DDL bloqueados                          | idem                                                                         |
| KV: leituras                        | 100.000 / dia                            | Operação falha com erro                         | [KV pricing](https://developers.cloudflare.com/kv/platform/pricing)          |
| KV: escritas                        | **1.000 / dia**                          | idem                                            | idem                                                                         |
| KV: deletes / lists                 | 1.000 / dia cada                         | idem                                            | idem                                                                         |
| KV: armazenamento                   | 1 GB                                     | Não documentado                                 | idem                                                                         |
| R2: armazenamento                   | 10 GB-mês (só Standard)                  | Cobrança (!)                                    | [R2 pricing](https://developers.cloudflare.com/r2/pricing/index.md)          |
| R2: Classe A / Classe B             | 1 M / 10 M por mês                       | Cobrança (!)                                    | idem                                                                         |
| R2: egress                          | Gratuito                                 | n/a                                             | idem                                                                         |
| Pages: builds                       | 500 / mês, 1 simultâneo                  | Build bloqueado                                 | [Pages limits](https://developers.cloudflare.com/pages/platform/limits)      |
| Pages: arquivos / tamanho           | 20.000 / 25 MiB cada                     | Deploy falha                                    | idem                                                                         |
| Pages: projetos / domínios          | 100 por conta / 100 por projeto          | n/a                                             | idem                                                                         |
| Pages Functions                     | Contam na cota de requisições do Workers | Ver Workers                                     | idem                                                                         |
| Turnstile: widgets                  | 20 por conta; 10 hostnames por widget    | n/a                                             | [Turnstile plans](https://developers.cloudflare.com/turnstile/plans)         |
| Turnstile: verificações             | Ilimitadas; analytics 7 dias             | n/a                                             | idem                                                                         |

## 2. Itens NÃO confirmados (bloqueiam uso até confirmação)

1. **R2 exige cartão?** A página oficial de preços não diz. Há indício de que ativar o R2 exige método de pagamento mesmo no free tier (thread na comunidade Cloudflare, que não consegui abrir). Se exigir, R1/R8 proíbem o uso. **R2 fica desabilitado até o usuário confirmar no painel da Cloudflare, sem cadastrar cartão.** Alternativa: não ter armazenamento de arquivos nas fases iniciais (`execution_artifacts` guardado como texto no D1, com teto de tamanho).
2. **Cartão para conta Workers/D1/KV/Pages/Turnstile Free:** a documentação não menciona exigência. Confirmar ao criar a conta.
3. **CPU de PBKDF2 sob 10 ms:** ver risco no relatório. Medir antes de decidir parâmetros.

## 3. Consequências de projeto (propostas, a validar na Fase 1)

- **Gargalo de KV:** 1.000 escritas/dia inviabiliza contador de rate limit em KV por requisição, como o briefing sugere. Proposta: rate limit só em endpoints sensíveis (cadastro, login, convite, execução), com contador na tabela `rate_limit_counters` (D1), e KV apenas para cache de leitura curto.
- **Gargalo de D1:** 100.000 escritas/dia. Cada execução gera várias escritas (execução, passos, auditoria, uso). Logs de auditoria e `usage_records` precisam de teto por workspace.
- **Caps internos (proposta de partida, 80% do limite):** global 80.000 req/dia; 80.000 escritas D1/dia; 4M leituras D1/dia; recusa com erro claro antes do limite real. Cotas por workspace derivadas do global.
- **Sem cobrança por excesso** em Workers/D1/KV/Pages/Turnstile Free (a operação falha, não gera fatura). O risco financeiro está apenas no R2.
- **Fora do escopo por limite ou regra:** Queues, Workflows, Durable Objects, e-mail, push.

## 4. Orçamento medido na Fase 3 (D1: 100.000 escritas/dia)

Uma execução concluída sem aprovação grava ≈ 3 (cotas) + 1 (execução) + 1 (auditoria) + 1 (início) + N passos + 1 (final) + 1 (artefato) + 1 (uso). Com 5 passos: **≈ 15 escritas**; com aprovação, ≈ +4 (aprovação e decisão). O teto global de **3.000 execuções/dia** custa no pior caso **≈ 45.000–60.000 escritas/dia**, deixando folga para cadastro, login e marketplace. Os limites por usuário (50/dia) e por workspace (200/dia) existem para que um só abuso não consuma o orçamento global. Leituras são baratas frente aos 5 M/dia. O custo de CPU por execução com a entrada máxima ainda precisa ser **medido no deploy** (ver `limitations.md`).

## 5. Fase 4 (empresas)

Convites, membros e cotas são poucas escritas por ação (criar convite ≈ 2, aceitar ≈ 5, mudar papel/cota ≈ 2). Limites duros (3 empresas/usuário, 5 workspaces/empresa, 50 membros/workspace, 20 convites ativos/workspace) impedem crescimento ilimitado de linhas. A cota por membro reutiliza `rate_limit_counters` (1 escrita extra por execução quando há cota definida). Nada usa e-mail, R2 ou serviço pago.
