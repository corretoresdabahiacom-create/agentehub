-- Taxonomia de categorias (configuração, não dado de demonstração). Idempotente.
-- Nenhum agente, avaliação ou número é criado aqui (R5): o catálogo nasce vazio.
INSERT OR IGNORE INTO categories (id, slug, name_en, name_pt, sort_order) VALUES
  ('cat-research',     'research',     'Research',     'Pesquisa',        10),
  ('cat-documents',    'documents',    'Documents',    'Documentos',      20),
  ('cat-social-media', 'social-media', 'Social media', 'Redes sociais',   30),
  ('cat-productivity', 'productivity', 'Productivity', 'Produtividade',   40),
  ('cat-data',         'data',         'Data',         'Dados',           50);
