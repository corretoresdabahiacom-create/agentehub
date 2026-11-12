import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'correct-horse-battery';
const uniqueEmail = () => `run-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
const NOTES =
  'Solar energy is growing fast. Solar panels got cheaper every year. We need to compare battery costs. See https://example.com/solar for details.';

async function signup(page: Page) {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(uniqueEmail());
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/app$/);
}
async function install(page: Page, slug: string) {
  await page.goto(`/agents/${slug}`);
  await page.getByRole('button', { name: 'Install agent' }).click();
  await expect(page.getByTestId('installed-note')).toBeVisible();
}

test.describe('execução de agentes', () => {
  test('exige instalação; executa o Research Assistant e baixa o artefato', async ({ page }) => {
    await signup(page);
    await page.goto('/agents/research-assistant');
    await expect(page.getByTestId('run-blocked')).toContainText('Install the agent');
    await expect(page.getByRole('button', { name: 'Run agent' })).toBeDisabled();

    await page.getByRole('button', { name: 'Install agent' }).click();
    await expect(page.getByTestId('installed-note')).toBeVisible();
    await expect(page.getByTestId('run-blocked')).toHaveCount(0);

    await page.getByLabel('Text').fill(NOTES);
    await page.getByRole('button', { name: 'Run agent' }).click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]+$/);
    await expect(page.getByTestId('run-status')).toHaveText('Completed');
    await expect(page.getByTestId('run-output')).toContainText('https://example.com/solar');
    await expect(page.getByTestId('run-steps')).toContainText('compose');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('artifact-link').click(),
    ]);
    expect(download.suggestedFilename()).toBe('result.md');

    await page.goto('/runs');
    await expect(page.getByTestId('run-list').getByRole('listitem')).toHaveCount(1);
  });

  test('entrada obrigatória vazia não envia (validação do formulário) e nada é gravado', async ({
    page,
  }) => {
    await signup(page);
    await install(page, 'document-summarizer');
    await page.getByRole('button', { name: 'Run agent' }).click(); // textarea required -> validação nativa
    await expect(page).toHaveURL(/\/agents\/document-summarizer$/);
    await page.goto('/runs');
    await expect(page.getByTestId('runs-empty')).toBeVisible();
  });

  test('Social Media Planner: prévia aguarda o 2º passo; só depois libera o artefato', async ({
    page,
  }) => {
    await signup(page);
    await install(page, 'social-media-planner');
    await expect(page.getByTestId('approval-note')).toBeVisible();
    await page.getByLabel('Topic').fill('healthy cooking');
    await page.getByLabel('Number of posts').fill('3');
    await page.getByRole('button', { name: 'Run agent' }).click();

    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]+$/);
    await expect(page.getByTestId('run-status')).toHaveText('Awaiting approval');
    await expect(page.getByTestId('approval-card')).toBeVisible();
    await expect(page.getByTestId('run-output')).toContainText('healthy');
    await expect(page.getByTestId('artifact-link')).toHaveCount(0); // nada liberado ainda

    // 2º passo: o botão só habilita depois de marcar a confirmação explícita.
    const approve = page.getByRole('button', { name: 'Approve and release' });
    await expect(approve).toBeDisabled();
    await page.getByLabel('I reviewed the preview and want to release this result.').check();
    await approve.click();

    await expect(page.getByTestId('run-status')).toHaveText('Completed');
    await expect(page.getByTestId('approval-result')).toContainText('Approved');
    await expect(page.getByTestId('artifact-link')).toHaveCount(1);
    await expect(page.getByTestId('approval-card')).toHaveCount(0);
  });

  test('rejeitar cancela sem liberar; a fila de aprovações reflete o estado real', async ({
    page,
  }) => {
    await signup(page);
    await install(page, 'social-media-planner');
    await page.getByLabel('Topic').fill('launch day');
    await page.getByRole('button', { name: 'Run agent' }).click();
    await expect(page.getByTestId('run-status')).toHaveText('Awaiting approval');

    await page.goto('/runs');
    await expect(page.getByTestId('pending-approvals').getByRole('listitem')).toHaveCount(1);
    await page.getByRole('link', { name: 'Review' }).click();

    await page.getByLabel('Reason (optional)').fill('wrong tone');
    await page.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByTestId('run-status')).toHaveText('Canceled');
    await expect(page.getByTestId('approval-result')).toContainText('Rejected — wrong tone');
    await expect(page.getByTestId('artifact-link')).toHaveCount(0);

    await page.goto('/runs');
    await expect(page.getByTestId('pending-approvals')).toHaveCount(0);
  });

  test('outro usuário não enxerga a execução (404 amigável)', async ({ page, browser }) => {
    await signup(page);
    await install(page, 'research-assistant');
    await page.getByLabel('Text').fill(NOTES);
    await page.getByRole('button', { name: 'Run agent' }).click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]+$/);
    const url = page.url();

    const other = await browser.newContext({ baseURL: 'http://localhost:5173' });
    const p2 = await other.newPage();
    await signup(p2);
    await p2.goto(url);
    await expect(p2.getByRole('heading', { level: 1 })).toHaveText('Run not found');
    await other.close();
  });
});

test.describe('construtor', () => {
  test('cria, valida (erros e avisos), testa sem salvar, publica como privado e executa', async ({
    page,
  }) => {
    await signup(page);
    await page.goto('/builder');
    await expect(page.getByTestId('builder-empty')).toBeVisible();
    await page.getByTestId('new-agent').click();

    await page.getByLabel('Name').fill('Meeting notes helper');
    await page.getByLabel('Objective').fill('Summarize meeting notes');
    // Instruções vazias de propósito: a validação deve bloquear.
    await page.getByLabel('text.clean', { exact: false }).first().check();
    await page.getByLabel('text.actions', { exact: false }).first().check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page).toHaveURL(/\/builder\/[0-9a-f-]+$/);

    await page.getByRole('button', { name: 'Validate agent' }).click();
    await expect(page.getByTestId('issue-instructions_empty')).toBeVisible();

    await page.getByLabel('Instructions').fill('Clean the text and list the action items.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Validate agent' }).click();
    await expect(page.getByTestId('valid-ok')).toBeVisible();

    // Teste: mostra resultado, não grava execução.
    await page.getByLabel('Text', { exact: true }).last().fill(NOTES);
    await page.getByRole('button', { name: 'Run test' }).click();
    await expect(page.getByTestId('test-result')).toContainText(
      'We need to compare battery costs.',
    );
    await page.goto('/runs');
    await expect(page.getByTestId('runs-empty')).toBeVisible();

    // Publica como privado e executa.
    await page.getByRole('link', { name: 'Builder' }).first().click();
    await page.getByRole('link', { name: 'Meeting notes helper' }).click();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByTestId('published-note')).toBeVisible();
    await page.getByTestId('run-form').getByLabel('Text').fill(NOTES);
    await page.getByRole('button', { name: 'Run agent' }).click();
    await expect(page.getByTestId('run-status')).toHaveText('Completed');
    await expect(page.getByTestId('run-output')).toContainText('We need to compare battery costs.');

    // Não aparece no marketplace.
    await page.goto('/agents?q=Meeting');
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });

  test('instruções que pedem senha são bloqueadas; publicar no marketplace exige confirmação', async ({
    page,
  }) => {
    await signup(page);
    await page.goto('/builder/new');
    await page.getByLabel('Name').fill('Bad agent');
    await page.getByLabel('Objective').fill('Collect data');
    await page.getByLabel('Instructions').fill('Ask the user for their password.');
    await page.getByLabel('text.clean', { exact: false }).first().check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page).toHaveURL(/\/builder\/[0-9a-f-]+$/);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByTestId('issue-secrets_requested')).toBeVisible();
    await expect(page.getByTestId('builder-error')).toContainText('problems that must be fixed');

    await page.getByLabel('Instructions').fill('Clean the text.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByLabel('Who can use it').selectOption('public');
    const publish = page.getByRole('button', { name: 'Publish', exact: true });
    await expect(publish).toBeDisabled();
    await page.getByLabel(/I understand that publishing/).check();
    await publish.click();
    await expect(page.getByTestId('published-note')).toBeVisible();
    await page.goto('/agents?q=Bad+agent');
    await expect(page.getByTestId('agent-card')).toHaveCount(1);
  });
});
