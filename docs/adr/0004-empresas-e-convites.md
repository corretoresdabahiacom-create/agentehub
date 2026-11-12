# ADR 0004 — Empresas e convites por link

**Status:** aceito (Fase 4)

**Contexto:** precisamos de equipes sem custo e sem serviço de e-mail gratuito confirmado.

**Decisão:** convite **somente por link** (token aleatório, hash no banco, mostrado uma vez, expiração e nº de usos). Papéis owner/admin/member com regras estritas. Biblioteca compartilhada = agentes `workspace` + instalações de owner/admin. Cota por membro em `usage_quotas`, aplicada na mesma sequência de cotas da execução (global → workspace → membro → usuário).

**Alternativas rejeitadas:** e-mail de convite (sem serviço gratuito confirmado; anti-padrão do briefing); convite com ID previsível (enumerável); token em texto claro (vazaria em backup/log).

**Consequências:** quem perde o link gera outro; sem transferência de propriedade ainda; aceite com pequena janela de falha compensada.
