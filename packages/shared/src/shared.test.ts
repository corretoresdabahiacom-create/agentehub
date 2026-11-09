import { describe, expect, it } from 'vitest';
import { loginSchema, roleAtLeast, signupSchema } from './index';

describe('roleAtLeast', () => {
  it('ordena member < admin < owner', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true);
    expect(roleAtLeast('admin', 'admin')).toBe(true);
    expect(roleAtLeast('member', 'admin')).toBe(false);
    expect(roleAtLeast('admin', 'owner')).toBe(false);
  });
});

describe('signupSchema', () => {
  it('normaliza e-mail e aplica locale padrão', () => {
    const out = signupSchema.parse({ email: '  User@Example.COM ', password: 'x'.repeat(12) });
    expect(out.email).toBe('user@example.com');
    expect(out.locale).toBe('en');
  });
  it('rejeita senha curta e e-mail inválido', () => {
    expect(signupSchema.safeParse({ email: 'a@b.co', password: 'curta' }).success).toBe(false);
    expect(signupSchema.safeParse({ email: 'nao-e-email', password: 'x'.repeat(12) }).success).toBe(
      false,
    );
  });
  it('rejeita senha acima do teto', () => {
    expect(signupSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(129) }).success).toBe(
      false,
    );
  });
});

describe('loginSchema', () => {
  it('não exige comprimento mínimo no login', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });
});
