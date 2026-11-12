# Limitações conhecidas

- **Sem funcionalidade de produto:** IA generativa, push, convites/empresas e painel admin chegam nas fases seguintes (marketplace: Fase 2; construtor e execução: Fase 3). A UI mostra “não configurado/indisponível”, nunca simula (R4/R5).
- **PBKDF2 pode exceder 10 ms de CPU** no plano free (ver `security.md` e `adr/0002-pbkdf2-e-deploy.md`: decisão de manter, medir no primeiro deploy e, só se reprovar, derivar parte no cliente). Primeiro item a validar no deploy.
- **R2 desabilitado:** exigência de cartão não confirmada (ver `free-tier-limits.md`).
- **Deploy ainda não feito.** Decidido: um único Worker com Static Assets serve frontend e API (ADR 0002); falta configurar `assets` e provisionar D1/segredos. Hoje só roda local e no E2E.
- **Histórico offline cifrado (IndexedDB)** continua adiado: o histórico de execuções existe, mas só no servidor (D1). Hoje o PWA guarda só shell e assets.
- **Manifest estático:** nome e cores do PWA valem em tempo de build; a marca editável pelo admin (Fase 6) vale dentro do app.
- **Idiomas:** EN e PT na interface; ES tem estrutura e fallback, sem traduções.
- **Sem verificação de e-mail, recuperação de senha, 2FA ou login social.**
- **Cadastro com Turnstile real não foi exercitado de ponta a ponta** (exige chaves da Cloudflare); coberto por testes com `siteverify` simulado na API.

## Fase 2

- **O catálogo só tem os 3 agentes oficiais** (migração 0005) até haver criadores publicando de verdade. O script `seed-demo` foi removido na Fase 3.
- Avaliar exige instalação **e** execução concluída recente; isso agora é possível de verdade (Fase 3). Os E2E da regra ainda fabricam a execução no banco local para controlar a data.
- **Instalar** libera a execução no workspace; a versão vigente é a executada (sem fixar versão por usuário).
- **Busca simples** (`LIKE`): sem relevância, sem tolerância a erros de digitação, sem FTS. Suficiente para o volume inicial; reavaliar se o catálogo crescer.
- **Sem moderação** de avaliações ainda (painel admin na Fase 6); o campo `status = hidden` já é respeitado.
- **Agentes privados não aparecem** no marketplace (só em Meus agentes); visibilidade `workspace` responde 422 `visibility_unavailable` até a Fase 4.
- **Conteúdo do agente em um só idioma** (o que o criador escreveu); só a interface é traduzida.
- **E2E dependem de ordem** (`workers: 1`, banco recriado a cada execução): o primeiro teste do marketplace assume que ainda não há avaliações/instalações.

## Fase 3

- **Os agentes são determinísticos, não IA.** Resumo é _extrativo_ (frases do próprio texto), palavras-chave são contagem de frequência, calendário social vem de modelos. Nenhum provedor de IA está configurado; um agente com a ferramenta `ai.generate` é recusado antes de qualquer custo (`ai_not_configured`). A interface `AIProvider` existe (`apps/api/src/ai/provider.ts`), mas nenhuma implementação.
- **Validação do agente é heurística** (palavras-chave EN/PT para segredos, ações perigosas e externas). Tem falsos positivos e negativos e **não é garantia**. A barreira real é a whitelist: o agente só consegue chamar ferramentas determinísticas que não fazem rede, não leem arquivos e não executam código.
- **Nenhuma ação externa é executada** (e-mail, publicação em redes). A aprovação humana libera um **texto** para a pessoa copiar/baixar; o que ela faz com ele é fora da plataforma.
- **Tempo é melhor esforço:** no Workers o relógio só avança em operações de E/S, então o limite de duração (`maxDurationMs`) não interrompe um laço puro de CPU. O que protege é o tamanho máximo de entrada (30.000 caracteres), o teto de passos e algoritmos lineares. O custo de CPU com a entrada máxima precisa ser **medido no primeiro deploy** (limite free: 10 ms de CPU por requisição).
- **Execução é síncrona** dentro da requisição (sem fila: Queues está fora do free tier). Uma queda do Worker no meio deixa a execução em `running`/`pending`; o acesso seguinte a marca como `failed`/`canceled` (`interrupted`) após 2 minutos.
- **Aprovação expira em 72 h, aplicada no acesso** (sem cron): ela só vira `canceled` quando alguém abre, tenta decidir ou cancela a execução; a fila `/approvals` já oculta as vencidas.
- **Empresas (Fase 4):** criadas pela interface/API (máx. 3 por usuário, 5 workspaces por empresa, 50 membros por workspace).
- **Cotas diárias** (50/usuário, 200/workspace, 3.000 globais) usam janelas fixas em UTC e `rate_limit_counters`; a recusa acontece antes de gravar a execução. Um pedido recusado por uma cota pode já ter consumido a cota mais ampla (contagem levemente pessimista).
- **Teste de agente no construtor não é persistido** e a tabela `agent_tests` ainda não é usada.
- **Máximo de 25 agentes por usuário**, 4.000 caracteres de instruções e 100.000 de saída, para proteger o orçamento de escritas do D1.
- **Publicar no marketplace é irreversível** na interface (público não volta a privado; só arquivar) e exige confirmação explícita.

## Fase 4

- **Convite só por link.** Não há e-mail de convite (não existe serviço de e-mail gratuito confirmado). O link aparece **uma única vez**; só o hash SHA-256 fica no banco. Quem perde o link cria outro. Link inválido, expirado, revogado ou esgotado responde igual (404 `invite_invalid`).
- **Sem transferência de propriedade** nem exclusão de empresa/workspace. O owner não pode ser rebaixado nem removido. Só o owner convida admins e troca papéis.
- **Biblioteca compartilhada** = agentes com visibilidade `workspace` + agentes públicos instalados por owner/admin. Instalação feita por membro comum não compartilha. Agente de workspace só é editável pelo criador (que precisa continuar membro); se ele sair, o agente segue disponível mas sem editor até haver transferência.
- **Cota por membro** (0–50/dia, janela UTC) vale só para execuções; não há cota por agente. Cota 0 bloqueia o membro.
- **Aceite de convite** consome o uso e depois grava as participações (com decremento compensatório em falha); uma queda do Worker exatamente entre os dois passos pode gastar um uso sem criar o membro (raro, o convite pode ser recriado).
- **Histórico do workspace** é visível só para owner/admin; membro vê apenas as próprias execuções.
