import type { ApiError } from '@agenthub/shared';
import type { Context } from 'hono';
import type { ZodType } from 'zod';
import type { AppEnv } from '../env';

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 405 | 409 | 413 | 415 | 429 | 500 | 503,
    public code: string,
    message?: string,
    public details?: unknown,
    public headers?: Record<string, string>,
  ) {
    super(message ?? code);
  }
}

export function errorBody(code: string, message: string, details?: unknown): ApiError {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

const MAX_BODY_BYTES = 16 * 1024;

/** Lê e valida o corpo JSON. Limita o tamanho e nunca devolve o conteúdo recebido nos erros. */
export async function parseJson<T>(c: Context<AppEnv>, schema: ZodType<T>): Promise<T> {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  }
  const text = await c.req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    // Apenas caminho e código: nunca ecoar valores (podem conter senha).
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code }));
    throw new HttpError(400, 'validation_error', 'Invalid input', issues);
  }
  return result.data;
}

/** Data UTC no formato YYYY-MM-DD. */
export function utcDay(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}
