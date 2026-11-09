/**
 * Primitivas criptográficas (somente Web Crypto; nenhuma dependência).
 *
 * Senhas: PBKDF2-HMAC-SHA256 com salt aleatório por usuário e "pepper" de servidor.
 * O pepper é aplicado como HMAC-SHA256(pepper, senha) ANTES do PBKDF2, de modo que um
 * vazamento só do banco não permite ataque offline sem também obter o segredo.
 *
 * Iterações: 100.000 é o máximo que o runtime do Workers aceita em `deriveBits`, e fica abaixo da
 * recomendação atual da OWASP para PBKDF2-SHA256. Esse déficit é compensado por pepper, rate limit
 * e Turnstile, e é um risco declarado em docs/security.md. O formato guarda as iterações para
 * permitir migração (needsRehash) sem invalidar contas.
 */
const encoder = new TextEncoder();

export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const SCHEME = 'pbkdf2-sha256';

export function b64Encode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function b64Decode(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlEncode(bytes: Uint8Array): string {
  return b64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (const b of view) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Token aleatório URL-safe (256 bits por padrão). */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64urlEncode(buf);
}

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(input)));
}

async function hmacBytes(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

/** HMAC-SHA256 em hex. Usado para anonimizar IP/e-mail em contadores e logs. */
export async function hmacHex(secret: string, data: string): Promise<string> {
  return toHex(await hmacBytes(secret, data));
}

/** Comparação em tempo constante. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function derive(
  password: string,
  pepper: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const prehash = await hmacBytes(pepper, password);
  const key = await crypto.subtle.importKey('raw', prehash, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, pepper: string): Promise<string> {
  if (!pepper) throw new Error('PASSWORD_PEPPER ausente');
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await derive(password, pepper, salt, PBKDF2_ITERATIONS);
  return `${SCHEME}$${PBKDF2_ITERATIONS}$${b64Encode(salt)}$${b64Encode(hash)}`;
}

interface ParsedHash {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== SCHEME) return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS)
    return null;
  try {
    return { iterations, salt: b64Decode(parts[2] ?? ''), hash: b64Decode(parts[3] ?? '') };
  } catch {
    return null;
  }
}

export async function verifyPassword(
  password: string,
  stored: string,
  pepper: string,
): Promise<boolean> {
  if (!pepper) throw new Error('PASSWORD_PEPPER ausente');
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const candidate = await derive(password, pepper, parsed.salt, parsed.iterations);
  return timingSafeEqual(candidate, parsed.hash);
}

export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  return !parsed || parsed.iterations < PBKDF2_ITERATIONS;
}

/**
 * Hash válido de uma senha que ninguém conhece (salt e hash constantes, SEM relação com qualquer
 * usuário). Serve apenas para gastar o mesmo tempo quando o e-mail não existe, reduzindo a
 * diferença de tempo que permitiria enumerar contas. Não é segredo.
 */
export const DUMMY_PASSWORD_HASH = `${SCHEME}$${PBKDF2_ITERATIONS}$${b64Encode(new Uint8Array(SALT_BYTES))}$${b64Encode(new Uint8Array(HASH_BITS / 8))}`;
