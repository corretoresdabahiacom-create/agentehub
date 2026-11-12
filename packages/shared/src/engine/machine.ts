/**
 * Máquina de estados da execução (pura). Toda mudança de estado no servidor passa por `transition`;
 * transição não prevista lança erro. Estados terminais: completed, canceled. `failed` só sai por RETRY.
 */
export const EXECUTION_STATES = [
  'pending',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'canceled',
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const EXECUTION_EVENTS = [
  'START',
  'REQUEST_APPROVAL',
  'APPROVE',
  'REJECT',
  'COMPLETE',
  'FAIL',
  'CANCEL',
  'RETRY',
] as const;
export type ExecutionEvent = (typeof EXECUTION_EVENTS)[number];

const TABLE: Record<ExecutionState, Partial<Record<ExecutionEvent, ExecutionState>>> = {
  pending: { START: 'running', CANCEL: 'canceled' },
  running: {
    REQUEST_APPROVAL: 'awaiting_approval',
    COMPLETE: 'completed',
    FAIL: 'failed',
    CANCEL: 'canceled',
  },
  awaiting_approval: {
    APPROVE: 'completed',
    REJECT: 'canceled',
    CANCEL: 'canceled',
    FAIL: 'failed',
  },
  completed: {},
  failed: { RETRY: 'pending' },
  canceled: {},
};

export class InvalidTransitionError extends Error {
  constructor(
    public from: ExecutionState,
    public event: ExecutionEvent,
  ) {
    super(`Invalid transition: ${from} --${event}-->`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: ExecutionState, event: ExecutionEvent): boolean {
  return TABLE[from][event] !== undefined;
}

export function transition(from: ExecutionState, event: ExecutionEvent): ExecutionState {
  const to = TABLE[from][event];
  if (!to) throw new InvalidTransitionError(from, event);
  return to;
}

export const isTerminal = (s: ExecutionState): boolean => s === 'completed' || s === 'canceled';
export const eventsFrom = (s: ExecutionState): ExecutionEvent[] =>
  Object.keys(TABLE[s]) as ExecutionEvent[];
