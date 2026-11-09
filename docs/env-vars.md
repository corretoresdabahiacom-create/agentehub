# Variáveis de ambiente (API)

Valores não secretos ficam em `apps/api/wrangler.jsonc`. **Segredos nunca entram no repositório**: em dev vão em `apps/api/.dev.vars` (ignorado pelo git, gerado por `npm run setup:dev`); em produção usar `wrangler secret put`.

| Variável                    | Tipo         | Padrão (prod) | Descrição                                                                        |
| --------------------------- | ------------ | ------------- | -------------------------------------------------------------------------------- |
| `ENVIRONMENT`               | var          | `production`  | `production`, `development` ou `test`                                            |
| `TURNSTILE_MODE`            | var          | `enforce`     | `enforce` ou `disabled_dev` (este só vale com `ENVIRONMENT=development`)         |
| `TURNSTILE_SITE_KEY`        | var          | vazio         | Chave **pública** do widget                                                      |
| `TURNSTILE_SECRET_KEY`      | **segredo**  | —             | Chave secreta do Turnstile; sem ela e com `enforce`, cadastro/login retornam 503 |
| `PASSWORD_PEPPER`           | **segredo**  | —             | Obrigatório; gerar com 32+ bytes aleatórios; trocar invalida todas as senhas     |
| `APP_ORIGINS`               | var          | vazio         | Origens extras aceitas no teste de CSRF, separadas por vírgula                   |
| `SIGNUP_OPEN`               | var          | `true`        | Chave geral de cadastro (combina com a flag `signup_open` no D1)                 |
| `GLOBAL_SIGNUPS_PER_DAY`    | var          | `1000`        | Cap diário global (free tier)                                                    |
| `GLOBAL_LOGINS_PER_DAY`     | var          | `5000`        | Cap diário global                                                                |
| `SIGNUP_PER_IP_PER_HOUR`    | var opcional | 5             | Sobrescreve o limite por IP (uso local/E2E)                                      |
| `LOGIN_PER_IP_PER_10MIN`    | var opcional | 20            | Idem                                                                             |
| `LOGIN_PER_EMAIL_PER_10MIN` | var opcional | 10            | Idem                                                                             |

Frontend: nenhuma variável com segredo. `API_ORIGIN` (opcional, só dev/preview) muda o alvo do proxy `/api` (padrão `http://localhost:8787`).
