# Limitações conhecidas (Fase 1)

- **Sem funcionalidade de produto:** execução de agentes, construtor, IA, push, convites e painel admin chegam nas fases seguintes (o marketplace chegou na Fase 2). A UI mostra “não configurado/indisponível”, nunca simula (R4/R5).
- **PBKDF2 pode exceder 10 ms de CPU** no plano free (ver `security.md` e `adr/0002-pbkdf2-e-deploy.md`: decisão de manter, medir no primeiro deploy e, só se reprovar, derivar parte no cliente). Primeiro item a validar no deploy.
- **R2 desabilitado:** exigência de cartão não confirmada (ver `free-tier-limits.md`).
- **Deploy ainda não feito.** Decidido: um único Worker com Static Assets serve frontend e API (ADR 0002); falta configurar `assets` e provisionar D1/segredos. Hoje só roda local e no E2E.
- **Histórico offline cifrado (IndexedDB)** adiado: não há histórico até a Fase 3. Hoje o PWA guarda só shell e assets.
- **Manifest estático:** nome e cores do PWA valem em tempo de build; a marca editável pelo admin (Fase 6) vale dentro do app.
- **Idiomas:** EN e PT na interface; ES tem estrutura e fallback, sem traduções.
- **Sem verificação de e-mail, recuperação de senha, 2FA ou login social.**
- **Cadastro com Turnstile real não foi exercitado de ponta a ponta** (exige chaves da Cloudflare); coberto por testes com `siteverify` simulado na API.

## Fase 2

- **O catálogo de produção está vazio** até haver criadores (Fase 3). Para ver a interface preenchida localmente: `npm run db:seed-demo:local -w @agenthub/api`.
- **Ninguém consegue executar agentes ainda**, logo ninguém consegue **avaliar** em produção (a regra exige execução concluída). A UI explica isso ao usuário. Os testes fabricam execuções direto no banco local para exercitar a regra.
- **Instalar só salva** o agente no workspace; não há execução, configuração nem versão fixada pelo usuário.
- **Busca simples** (`LIKE`): sem relevância, sem tolerância a erros de digitação, sem FTS. Suficiente para o volume inicial; reavaliar se o catálogo crescer.
- **Sem moderação** de avaliações ainda (painel admin na Fase 6); o campo `status = hidden` já é respeitado.
- **Agentes privados/de workspace não aparecem** no marketplace (Fases 3-4).
- **Conteúdo do agente em um só idioma** (o que o criador escreveu); só a interface é traduzida.
- **E2E dependem de ordem** (`workers: 1`, banco recriado a cada execução): o primeiro teste do marketplace assume que ainda não há avaliações/instalações.
