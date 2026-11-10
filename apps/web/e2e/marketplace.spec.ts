import { expect, test, type Page } from '@playwright/test';
import { completeExecution } from './db';

const PASSWORD = 'correct-horse-battery';
const uniqueEmail = () => `mkt-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
const DOC = 'demo-document-summarizer';

async function signup(page: Page, email = uniqueEmail()) {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}

test.describe('catálogo público', () => {
  test('lista agentes reais do banco, todos marcados como demo, sem números inventados', async ({
    page,
  }) => {
    await page.goto('/agents');
    await expect(page.getByTestId('result-count')).toHaveText('3 agents found');
    const cards = page.getByTestId('agent-card');
    await expect(cards).toHaveCount(3);
    await expect(page.getByTestId('demo-badge')).toHaveCount(3);
    // Nenhuma avaliação nem instalação foi fabricada.
    await expect(cards.first()).toContainText('No reviews yet');
    await expect(cards.first()).toContainText('0 installs');
  });

  test('busca por texto, atualiza a URL e mostra estado vazio com opção de limpar', async ({
    page,
  }) => {
    await page.goto('/agents');
    await page.getByRole('searchbox').fill('calendar');
    await expect(page).toHaveURL(/q=calendar/);
    await expect(page.getByTestId('agent-card')).toHaveCount(1);
    await expect(page.getByTestId('agent-card')).toContainText('Social Media Planner');

    await page.getByRole('searchbox').fill('zzz-nothing-matches');
    await expect(page.getByTestId('empty-state')).toContainText('No agents match these filters.');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByTestId('agent-card')).toHaveCount(3);

    // Curingas SQL são tratados como texto.
    await page.getByRole('searchbox').fill('%');
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });

  test('filtra por categoria (com contagens reais) e ordena por nome', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.getByRole('button', { name: 'Research (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Documents (1)' }).click();
    await expect(page).toHaveURL(/category=documents/);
    await expect(page.getByTestId('agent-card')).toHaveCount(1);
    await expect(page.getByTestId('agent-card')).toContainText('Document Summarizer');

    await page.getByRole('button', { name: 'All categories' }).click();
    await page.getByLabel('Sort by').selectOption('name');
    await expect(page).toHaveURL(/sort=name/);
    const names = await page.getByTestId('agent-link').allTextContents();
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  test('catálogo reage ao idioma (categorias em português)', async ({ page }) => {
    await page.goto('/agents');
    await page.getByLabel('Language').first().selectOption('pt');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Marketplace');
    await expect(page.getByRole('button', { name: 'Pesquisa (1)' })).toBeVisible();
    await expect(page.getByTestId('result-count')).toHaveText('3 agentes encontrados');
  });
});

test.describe('página do agente', () => {
  test('mostra detalhes reais e o aviso de demonstração; anônimo é convidado a entrar', async ({
    page,
  }) => {
    await page.goto(`/agents/${DOC}`);
    await expect(page.getByTestId('agent-name')).toHaveText('Document Summarizer (demo)');
    await expect(page.getByTestId('demo-banner')).toContainText('cannot be run');
    await expect(page.getByText('text.summarize, text.template')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Install agent' })).toHaveCount(0);
  });

  test('agente inexistente ou não publicado mostra 404 amigável', async ({ page }) => {
    await page.goto('/agents/nao-existe');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Agent not found');
  });
});

test.describe('instalar, favoritar e avaliar', () => {
  test('instala, favorita, aparece nos escopos e desinstala', async ({ page }) => {
    await signup(page);
    await page.goto(`/agents/${DOC}`);
    await page.getByRole('button', { name: 'Install agent' }).click();
    await expect(page.getByTestId('installed-note')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Uninstall' })).toBeVisible();

    await page.getByRole('button', { name: 'Add to favorites' }).click();
    await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();

    await page.goto('/agents?scope=installed');
    await expect(page.getByTestId('agent-card')).toHaveCount(1);
    await page.goto('/agents?scope=favorites');
    await expect(page.getByTestId('agent-card')).toHaveCount(1);

    await page.goto(`/agents/${DOC}`);
    await page.getByRole('button', { name: 'Uninstall' }).click();
    await expect(page.getByRole('button', { name: 'Install agent' })).toBeVisible();
    await page.goto('/agents?scope=installed');
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });

  test('avaliação qualificada: só após instalar E ter execução concluída; selo "verificada"', async ({
    page,
  }) => {
    const email = await signup(page);
    await page.goto(`/agents/${DOC}`);

    // 1) Sem instalação: não pode avaliar.
    await expect(page.getByTestId('review-ineligible')).toContainText('Install it first');
    await expect(page.getByTestId('review-form')).toHaveCount(0);

    // 2) Instalado, mas sem execução concluída: continua sem poder.
    await page.getByRole('button', { name: 'Install agent' }).click();
    await expect(page.getByTestId('installed-note')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('review-ineligible')).toContainText('completed run');
    await expect(page.getByTestId('review-form')).toHaveCount(0);

    // 3) Execução concluída (fixture no banco local): agora pode.
    completeExecution(email, DOC);
    await page.reload();
    await expect(page.getByTestId('review-form')).toBeVisible();
    await page.getByLabel('5', { exact: true }).check();
    await page.getByLabel('Comment (optional)').fill('Clear summaries <script>1</script>');
    await page.getByRole('button', { name: 'Publish review' }).click();

    const item = page.getByTestId('review-item');
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId('verified-badge')).toHaveText('Verified');
    await expect(item).toContainText('Clear summaries <script>1</script>'); // texto puro, não HTML
    await expect(item).toContainText('Your review');
    await expect(
      page.getByRole('img', { name: /Rated 5\.0 out of 5 from 1 reviews/ }).first(),
    ).toBeVisible();

    // A avaliação é pública, anônima e mantém o selo.
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await page.goto(`/agents/${DOC}`);
    await expect(page.getByTestId('review-item')).toHaveCount(1);
    await expect(page.getByTestId('verified-badge')).toBeVisible();
    await expect(page.getByTestId('review-item')).not.toContainText(email.split('@')[0]!);

    // O catálogo agora mostra a nota real.
    await page.goto('/agents');
    await expect(
      page.getByTestId('agent-card').filter({ hasText: 'Document Summarizer' }),
    ).toContainText('5.0 (1)');
  });

  test('outro usuário sem instalação não consegue avaliar mesmo vendo a avaliação de alguém', async ({
    page,
  }) => {
    await signup(page);
    await page.goto(`/agents/${DOC}`);
    await expect(page.getByTestId('review-ineligible')).toBeVisible();
    await expect(page.getByTestId('review-form')).toHaveCount(0);
  });
});
