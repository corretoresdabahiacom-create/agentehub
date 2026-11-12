import { describe, expect, it } from 'vitest';
import {
  canTransition,
  EXECUTION_EVENTS,
  EXECUTION_STATES,
  eventsFrom,
  InvalidTransitionError,
  isTerminal,
  transition,
  type ExecutionEvent,
  type ExecutionState,
} from './machine';

const ALLOWED: Array<[ExecutionState, ExecutionEvent, ExecutionState]> = [
  ['pending', 'START', 'running'],
  ['pending', 'CANCEL', 'canceled'],
  ['running', 'REQUEST_APPROVAL', 'awaiting_approval'],
  ['running', 'COMPLETE', 'completed'],
  ['running', 'FAIL', 'failed'],
  ['running', 'CANCEL', 'canceled'],
  ['awaiting_approval', 'APPROVE', 'completed'],
  ['awaiting_approval', 'REJECT', 'canceled'],
  ['awaiting_approval', 'CANCEL', 'canceled'],
  ['awaiting_approval', 'FAIL', 'failed'],
  ['failed', 'RETRY', 'pending'],
];

describe('máquina de estados da execução', () => {
  it('permite exatamente as transições previstas e nenhuma outra (tabela completa)', () => {
    for (const from of EXECUTION_STATES) {
      for (const event of EXECUTION_EVENTS) {
        const expected = ALLOWED.find(([f, e]) => f === from && e === event)?.[2];
        if (expected) {
          expect(transition(from, event), `${from}+${event}`).toBe(expected);
          expect(canTransition(from, event)).toBe(true);
        } else {
          expect(canTransition(from, event), `${from}+${event}`).toBe(false);
          expect(() => transition(from, event)).toThrow(InvalidTransitionError);
        }
      }
    }
  });

  it('estados terminais não têm saída; failed só sai por RETRY', () => {
    expect(eventsFrom('completed')).toEqual([]);
    expect(eventsFrom('canceled')).toEqual([]);
    expect(eventsFrom('failed')).toEqual(['RETRY']);
    expect(isTerminal('completed') && isTerminal('canceled')).toBe(true);
    expect(isTerminal('failed')).toBe(false);
  });

  it('todo estado é alcançável a partir de pending e nenhum caminho fica preso fora dos terminais', () => {
    const reach = new Set<ExecutionState>(['pending']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of [...reach]) {
        for (const e of eventsFrom(s)) {
          const to = transition(s, e);
          if (!reach.has(to)) {
            reach.add(to);
            grew = true;
          }
        }
      }
    }
    expect([...reach].sort()).toEqual([...EXECUTION_STATES].sort());
  });

  it('a mensagem do erro identifica a transição inválida', () => {
    try {
      transition('completed', 'START');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      expect((e as InvalidTransitionError).from).toBe('completed');
      expect((e as Error).message).toContain('completed');
    }
  });
});
