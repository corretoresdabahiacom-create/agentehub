import { z } from 'zod';

/** Limites da PLATAFORMA (teto que nenhum agente pode exceder) e padrões do construtor. */
export const PLATFORM_LIMITS = {
  maxInputChars: { min: 100, max: 30_000, default: 10_000 },
  maxSteps: { min: 1, max: 12, default: 8 },
  /** Tempo é "melhor esforço": no Workers o relógio só avança em I/O (ver docs/limitations.md). */
  maxDurationMs: { min: 100, max: 8_000, default: 3_000 },
  maxAttempts: { min: 1, max: 3, default: 2 },
  maxOutputChars: 100_000,
  /** Aprovação pendente expira (expiração é aplicada no acesso, sem cron). */
  approvalTtlHours: 72,
  /** Teto de execuções para proteger o free tier (escritas do D1). */
  executionsPerUserPerDay: 50,
  executionsPerWorkspacePerDay: 200,
  executionsGlobalPerDay: 3_000,
} as const;

const bounded = (k: 'maxInputChars' | 'maxSteps' | 'maxDurationMs' | 'maxAttempts') =>
  z.number().int().min(PLATFORM_LIMITS[k].min).max(PLATFORM_LIMITS[k].max);

/** Todos os campos são obrigatórios: "ausência de limites" é um erro de validação. */
export const agentLimitsSchema = z.strictObject({
  maxInputChars: bounded('maxInputChars'),
  maxSteps: bounded('maxSteps'),
  maxDurationMs: bounded('maxDurationMs'),
  maxAttempts: bounded('maxAttempts'),
  /** O agente exige aprovação humana antes de concluir. Ferramentas `approval: always` forçam true. */
  requireApproval: z.boolean(),
});
export type AgentLimits = z.infer<typeof agentLimitsSchema>;

export const DEFAULT_LIMITS: AgentLimits = {
  maxInputChars: PLATFORM_LIMITS.maxInputChars.default,
  maxSteps: PLATFORM_LIMITS.maxSteps.default,
  maxDurationMs: PLATFORM_LIMITS.maxDurationMs.default,
  maxAttempts: PLATFORM_LIMITS.maxAttempts.default,
  requireApproval: false,
};
