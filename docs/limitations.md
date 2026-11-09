# Limitações conhecidas (Fase 1)

- **Sem funcionalidade de produto:** marketplace, execução de agentes, IA, push, convites e painel admin chegam nas fases seguintes. A UI mostra “não configurado/indisponível”, nunca simula (R4/R5).
- **PBKDF2 pode exceder 10 ms de CPU** no plano free (ver `security.md`). Primeiro item a validar no deploy.
- **R2 desabilitado:** exigência de cartão não confirmada (ver `free-tier-limits.md`).
- **Topologia de deploy em aberto** (same-origin; ver `architecture.md`). Hoje só roda local e no E2E.
- **Histórico offline cifrado (IndexedDB)** adiado: não há histórico até a Fase 3. Hoje o PWA guarda só shell e assets.
- **Manifest estático:** nome e cores do PWA valem em tempo de build; a marca editável pelo admin (Fase 6) vale dentro do app.
- **Idiomas:** EN e PT na interface; ES tem estrutura e fallback, sem traduções.
- **Sem verificação de e-mail, recuperação de senha, 2FA ou login social.**
- **Cadastro com Turnstile real não foi exercitado de ponta a ponta** (exige chaves da Cloudflare); coberto por testes com `siteverify` simulado na API.
