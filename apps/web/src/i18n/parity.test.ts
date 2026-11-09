import { describe, expect, it } from 'vitest';
import en from './en.json';
import pt from './pt.json';

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('i18n parity', () => {
  it('pt has exactly the same keys as en', () => {
    expect(flatten(pt).sort()).toEqual(flatten(en).sort());
  });
  it('no empty translations', () => {
    for (const bundle of [en, pt]) {
      const flat = (o: Record<string, unknown>): string[] =>
        Object.values(o).flatMap((v) =>
          v && typeof v === 'object' ? flat(v as Record<string, unknown>) : [String(v)],
        );
      expect(flat(bundle).every((s) => s.trim().length > 0)).toBe(true);
    }
  });
});
