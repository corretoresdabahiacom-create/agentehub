-- Seed idempotente de configuração padrão. Nenhum dado de demonstração e nenhum segredo aqui.
-- monetization_enabled DEVE permanecer 0 (R7): não existe fluxo de cobrança na plataforma.
INSERT OR IGNORE INTO feature_flags (key, enabled, description) VALUES
  ('monetization_enabled', 0, 'Cobranças/planos. Permanece desligada; nenhuma rota de cobrança existe.'),
  ('signup_open', 1, 'Permite novos cadastros.'),
  ('ai_external_enabled', 0, 'Permite o usuário configurar provedor de IA externo (nenhum ativo por padrão).');

-- Marca configurável pelo painel administrativo (Fase 6). Valores são JSON.
INSERT OR IGNORE INTO system_settings (key, value_json) VALUES
  ('brand.name', '"AI AgentHub"'),
  ('brand.tagline', '"Find, configure and run specialist agents for professional tasks — with control over what they can do."');
