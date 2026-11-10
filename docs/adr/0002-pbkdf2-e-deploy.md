# ADR 0002 — PBKDF2 (manter e medir) e topologia de deploy

**Status:** aceita (início da Fase 2). **Contexto:** o usuário delegou a decisão sobre o risco de CPU do PBKDF2 (“decida o que for melhor e sem custos”) e decidiu **continuar no Worker**, com domínio próprio a ser configurado depois.

## 1. PBKDF2 contra o limite de 10 ms de CPU

- **Decisão:** manter PBKDF2-SHA256 com 100.000 iterações no servidor, como está. Não reduzir iterações (enfraqueceria a senha) e não migrar para algo pago.
- **Por quê:** é a opção nativa, sem dependência, aderente ao §8 e sem custo. O risco é de _medição_, não de projeto: o ~15 ms observado é tempo de relógio local; só um Worker implantado mostra quanto conta como CPU.
- **Plano de medição (primeiro deploy):** criar uma conta de teste e observar a taxa de erros 1102 (CPU excedida) em `/api/auth/signup` e `/api/auth/login`, nas métricas gratuitas do painel.
- **Contingência sem custo, só se a medição reprovar:** derivação em duas etapas. O navegador calcula uma chave com PBKDF2 (WebCrypto, 600.000 iterações, salt público derivado do e-mail) e envia só esse valor; o servidor continua guardando um hash salgado e com pepper **por cima** dele (uma iteração de HMAC/PBKDF2 curto). A senha em claro nunca sai do navegador nem é guardada. Custo: R$ 0. Efeito: o servidor deixa de pagar a derivação cara. É aditivo e reversível (`needsRehash`), mas **só será implementado se necessário**, com novo aviso ao usuário, porque altera o §8.
- **Não faremos:** plano pago do Workers (viola R1).

## 2. Deploy: frontend e API no mesmo Worker

- **Decisão:** um único Worker serve a API (`/api/*`) e os arquivos estáticos do frontend (Workers Static Assets, plano free, sem cartão). Mantém a mesma origem exigida pelo cookie `__Host-` + `SameSite=Lax` sem CORS.
- **Domínio:** o endereço `*.workers.dev` já funciona como origem única. Quando o usuário tiver domínio próprio, basta associá-lo ao Worker; nenhuma mudança de código é necessária. `APP_ORIGINS` só precisa ser preenchido se houver uma segunda origem.
- **Fica para a etapa de deploy (não feito na Fase 2):** adicionar `assets` ao `wrangler.jsonc` apontando para `apps/web/dist`, com `not_found_handling: single-page-application` e `run_worker_first` para `/api/*`; migrar o conteúdo de `public/_headers` (CSP etc.) para o Worker ou manter o arquivo `_headers`, que Static Assets também aceita.
- **Consequência:** `*.pages.dev` deixa de ser necessário; o limite de 500 builds/mês do Pages deixa de ser relevante. Os 100.000 req/dia do Workers passam a cobrir também as requisições de assets estáticos que passam pelo Worker (assets estáticos servidos diretamente não contam).
