// Gera apps/api/.dev.vars para desenvolvimento local. Nunca sobrescreve um arquivo existente.
// O PASSWORD_PEPPER é gerado ALEATORIAMENTE nesta máquina e fica fora do git (.gitignore).
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../apps/api/.dev.vars', import.meta.url));

if (existsSync(target)) {
  console.log(`.dev.vars já existe (${target}); nada a fazer.`);
  process.exit(0);
}

const content = [
  '# Gerado por scripts/setup-dev.mjs. NÃO versionar. Valores só para esta máquina.',
  'ENVIRONMENT=development',
  '# Anti-bot desligado SOMENTE no desenvolvimento local (a API recusa isso fora de development).',
  'TURNSTILE_MODE=disabled_dev',
  `PASSWORD_PEPPER=${randomBytes(32).toString('hex')}`,
  'APP_ORIGINS=http://localhost:5173',
  '# Limites afrouxados só localmente, para os testes E2E (todos partilham o mesmo IP).',
  'SIGNUP_PER_IP_PER_HOUR=1000',
  'LOGIN_PER_IP_PER_10MIN=1000',
  '',
].join('\n');

writeFileSync(target, content, { mode: 0o600 });
console.log(`Criado ${target}`);
