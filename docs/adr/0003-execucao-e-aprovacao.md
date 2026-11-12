# ADR 0003 — Motor de execução determinístico e aprovação humana

Status: aceita (Fase 3).

## Contexto

O briefing exige agentes executáveis sem IA obrigatória, estado de execução explícito, limites antes do custo, aprovação humana para ações irreversíveis (R6) e tudo no free tier (R1/R2), sem fila nem cron.

## Decisões

1. **Motor puro e determinístico** em `packages/shared`: ferramentas da whitelist, ordem canônica por estágio, sem rede/arquivo/eval. É testado como unidade e reutilizável pelo front para validar e mostrar entradas. Alternativa descartada: pipeline livre de passos escolhidos pelo criador (laços, ramificações), por abrir a porta a loops e a execução arbitrária.
2. **Execução síncrona na requisição.** Sem Queues/Workflows (fora do free). Com entrada ≤ 30.000 caracteres e algoritmos lineares, é viável; o custo de CPU será medido no primeiro deploy. Execuções penduradas por queda do Worker são recuperadas **no acesso** (`interrupted`).
3. **Estados com guarda otimista.** Cada transição é `UPDATE … WHERE status = <anterior>`; o resultado completo é gravado num único `db.batch` (atômico no D1).
4. **Aprovação:** necessária se a ferramenta é `approval: always` ou o agente declara `requireApproval`. Método por tipo de organização: `self_second_step` (individual: segundo pedido explícito do próprio usuário) ou `workspace_admin` (empresa: owner/admin, que pode ser o próprio solicitante quando é o único admin). O artefato só existe depois da aprovação. Um índice único parcial (`decision = 'pending'`) e UPDATE guardado dão um único vencedor em decisões concorrentes.
5. **Expiração de 72 h aplicada no acesso**, sem cron (cron é limitado no free e evitável).
6. **Recusa antes do custo:** IA ausente, tamanho, entrada obrigatória e cotas são verificados antes de gravar a execução. Cotas diárias via `rate_limit_counters` (janela UTC).
7. **IA como interface (`AIProvider`) sem implementação.** `ai.generate` é recusada com `ai_not_configured`; a UI e `/api/config` declaram isso.
8. **Validação de agente é heurística** e declarada como tal; a garantia vem da whitelist, não das palavras-chave.

## Consequências

- Resumos são extrativos e calendários vêm de modelos: a plataforma é útil sem IA, mas limitada ao que as regras fazem.
- O limite de duração é melhor esforço (o relógio do Workers só avança em E/S); a proteção real é tamanho de entrada + teto de passos.
- Aprovação por owner/admin só é exercitável pela interface quando existirem empresas (Fase 4); até lá é coberta por testes de API.
