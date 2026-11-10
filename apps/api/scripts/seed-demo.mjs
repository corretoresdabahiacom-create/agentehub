// Popula o D1 LOCAL com agentes de DEMONSTRAÇÃO (is_demo = 1), marcados como "demo" na interface.
// Uso: npm run db:seed-demo:local [-- --persist-to <dir>]
//
// Regras (R5): isto NUNCA roda em produção. O script só aceita `--local`, não existe caminho para
// `--remote`, e os dados nascem marcados como demonstração. Não há avaliações, instalações,
// execuções nem números inventados: só o cadastro de alguns agentes de exemplo.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

if (process.argv.includes('--remote')) {
  console.error('seed-demo: recusado. Dados de demonstração nunca vão para um banco remoto.');
  process.exit(1);
}
const persistIdx = process.argv.indexOf('--persist-to');
const persist = persistIdx > -1 ? ['--persist-to', process.argv[persistIdx + 1]] : [];

const PUBLISHER = 'demo-publisher';
const AGENTS = [
  {
    slug: 'demo-research-assistant',
    name: 'Research Assistant (demo)',
    description:
      'Demo listing. Shows how a research agent would be presented: collects sources, extracts key points and builds a cited summary.',
    objective: 'Turn a research question into a structured, source-cited brief.',
    categories: ['research'],
    tools: ['text.extract', 'text.template'],
  },
  {
    slug: 'demo-document-summarizer',
    name: 'Document Summarizer (demo)',
    description:
      'Demo listing. Shows how a document agent would be presented: condenses long text into sections, action items and a short abstract.',
    objective: 'Summarize a document into an abstract, key points and action items.',
    categories: ['documents', 'productivity'],
    tools: ['text.summarize', 'text.template'],
  },
  {
    slug: 'demo-social-media-planner',
    name: 'Social Media Planner (demo)',
    description:
      'Demo listing. Shows how a social media agent would be presented: turns a topic into a weekly post calendar from templates.',
    objective: 'Generate a weekly post calendar from a topic and tone.',
    categories: ['social-media'],
    tools: ['text.template', 'text.format'],
  },
];

const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
const lines = [
  `-- Gerado por seed-demo.mjs. Somente D1 local. Tudo aqui é demonstração (is_demo = 1).`,
  // Publicador técnico: hash inválido e suspenso => nunca consegue autenticar.
  `INSERT OR IGNORE INTO users (id, email, password_hash, status) VALUES (${q(PUBLISHER)}, 'demo-publisher@agenthub.invalid', 'disabled', 'suspended');`,
];
for (const a of AGENTS) {
  const vid = `${a.slug}-v1`;
  lines.push(
    `INSERT OR IGNORE INTO agents (id, creator_user_id, slug, name, description, visibility, status, current_version_id, is_demo) VALUES (${q(a.slug)}, ${q(PUBLISHER)}, ${q(a.slug)}, ${q(a.name)}, ${q(a.description)}, 'public', 'published', ${q(vid)}, 1);`,
    `INSERT OR IGNORE INTO agent_versions (id, agent_id, version, objective, output_format, status, created_by) VALUES (${q(vid)}, ${q(a.slug)}, 1, ${q(a.objective)}, 'markdown', 'published', ${q(PUBLISHER)});`,
  );
  for (const t of a.tools) {
    lines.push(
      `INSERT OR IGNORE INTO agent_tools (id, agent_version_id, tool_key) VALUES (${q(`${vid}-${t}`)}, ${q(vid)}, ${q(t)});`,
    );
  }
  for (const c of a.categories) {
    lines.push(
      `INSERT OR IGNORE INTO agent_categories (agent_id, category_id) SELECT ${q(a.slug)}, id FROM categories WHERE slug = ${q(c)};`,
    );
  }
}

const dir = mkdtempSync(path.join(tmpdir(), 'agenthub-seed-'));
const file = path.join(dir, 'demo.sql');
writeFileSync(file, lines.join('\n') + '\n');
execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', 'agenthub', '--local', ...persist, '--file', file],
  { stdio: 'inherit' },
);
process.stdout.write(
  `seed-demo: ${AGENTS.length} agentes de demonstração (is_demo=1) aplicados ao D1 local.\n`,
);
