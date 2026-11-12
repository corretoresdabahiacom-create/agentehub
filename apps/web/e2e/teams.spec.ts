import { expect, test, type Browser, type Page } from '@playwright/test';

const PASSWORD = 'correct-horse-battery';
const BASE = 'http://localhost:5173';
const uniqueEmail = (p: string) =>
  `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

async function signup(page: Page, prefix: string) {
  const email = uniqueEmail(prefix);
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}
async function newUser(browser: Browser, prefix: string) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  const email = await signup(page, prefix);
  return { ctx, page, email };
}
async function createCompany(page: Page, name: string) {
  await page.goto('/teams');
  await expect(page.getByTestId('no-companies')).toBeVisible();
  await page.getByTestId('new-company-form').getByLabel('Company name').fill(name);
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByTestId('companies')).toContainText(name);
  await page.getByTestId('companies').getByRole('link', { name: 'Main' }).click();
  await expect(page.getByTestId('team-title')).toHaveText('Main');
  return page.url().split('/').pop()!;
}
async function inviteLink(page: Page, role: 'member' | 'admin' = 'member'): Promise<string> {
  await page.getByTestId('invites').getByLabel('Role').selectOption(role);
  await page.getByRole('button', { name: 'Create link' }).click();
  const box = page.getByTestId('invite-link-box');
  await expect(box).toContainText('will not be shown again');
  return page.getByTestId('invite-link').inputValue();
}

test.describe('empresas: convite por link, papéis e isolamento', () => {
  test('convite por link: guest passa por login e volta; vira membro; link de 1 uso não vale de novo', async ({
    browser,
  }) => {
    const owner = await newUser(browser, 'owner');
    await createCompany(owner.page, 'Acme Corp');
    const link = await inviteLink(owner.page);
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);

    // visitante sem conta: vê a chamada para entrar e retorna ao convite após criar a conta
    const guestCtx = await browser.newContext({ baseURL: BASE });
    const guest = await guestCtx.newPage();
    await guest.goto(link);
    await expect(guest.getByTestId('invite-guest')).toBeVisible();
    await guest.getByTestId('invite-guest').getByRole('link', { name: 'Create account' }).click();
    await guest.getByLabel('Email').fill(uniqueEmail('guest'));
    await guest.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await guest.getByRole('button', { name: 'Create account' }).click();
    await expect(guest.getByTestId('invite-preview')).toContainText('Acme Corp');
    await guest.getByRole('button', { name: 'Accept invite' }).click();
    await expect(guest.getByTestId('team-title')).toHaveText('Main');
    // membro comum não vê gestão de membros/convites/histórico
    await expect(guest.getByTestId('members')).toHaveCount(0);
    await expect(guest.getByTestId('invites')).toHaveCount(0);
    await expect(guest.getByTestId('history')).toHaveCount(0);
    await expect(guest.getByTestId('library')).toBeVisible();

    // o link de 1 uso esgotou: outro usuário recebe a mesma mensagem genérica
    const other = await newUser(browser, 'late');
    await other.page.goto(link);
    await expect(other.page.getByTestId('invite-invalid')).toContainText('invalid, expired');

    // o dono vê o membro novo e o convite esgotado
    await owner.page.reload();
    await expect(owner.page.getByTestId('members').getByRole('row')).toHaveCount(3); // cabeçalho + 2
    await expect(owner.page.getByTestId('invite-list')).toContainText('1/1 uses');
    await owner.ctx.close();
    await guestCtx.close();
    await other.ctx.close();
  });

  test('revogar o link o invalida; dono muda papel, define cota e remove o membro', async ({
    browser,
  }) => {
    const owner = await newUser(browser, 'owner2');
    await createCompany(owner.page, 'Globex');
    const revoked = await inviteLink(owner.page);
    await owner.page.getByRole('button', { name: 'Revoke' }).first().click();
    const probe = await newUser(browser, 'probe');
    await probe.page.goto(revoked);
    await expect(probe.page.getByTestId('invite-invalid')).toBeVisible();

    const link = await inviteLink(owner.page);
    await probe.page.goto(link);
    await probe.page.getByRole('button', { name: 'Accept invite' }).click();
    await expect(probe.page.getByTestId('team-title')).toHaveText('Main');

    await owner.page.reload();
    const row = owner.page.getByTestId(`member-${probe.email}`);
    await row.getByLabel('Role').selectOption('admin');
    await expect(row.getByLabel('Role')).toHaveValue('admin');
    await row.getByLabel('Daily quota').fill('2');
    await row.getByRole('button', { name: 'Save' }).click();
    await owner.page.reload();
    await expect(
      owner.page.getByTestId(`member-${probe.email}`).getByLabel('Daily quota'),
    ).toHaveValue('2');

    await owner.page
      .getByTestId(`member-${probe.email}`)
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(owner.page.getByTestId(`member-${probe.email}`)).toHaveCount(0);
    // removido perde o acesso
    await probe.page.reload();
    await expect(probe.page.getByTestId('team-not-found')).toBeVisible();
    await owner.ctx.close();
    await probe.ctx.close();
  });

  test('isolamento: outro usuário não acessa o workspace por URL', async ({ browser }) => {
    const a = await newUser(browser, 'iso-a');
    const wsId = await createCompany(a.page, 'Alpha Co');
    const b = await newUser(browser, 'iso-b');
    await b.page.goto(`/teams/${wsId}`);
    await expect(b.page.getByTestId('team-not-found')).toBeVisible();
    const res = await b.page.request.get(`/api/workspaces/${wsId}/members`);
    expect(res.status()).toBe(404);
    await a.ctx.close();
    await b.ctx.close();
  });

  test('admin aprova no workspace a execução sensível de um membro; membro não decide', async ({
    browser,
  }) => {
    const owner = await newUser(browser, 'boss');
    const wsId = await createCompany(owner.page, 'Initech');
    // o owner instala o agente do marketplace no workspace da empresa (biblioteca compartilhada)
    await owner.page.goto('/agents/social-media-planner');
    await owner.page.getByLabel('Workspace').first().selectOption(wsId);
    await owner.page.getByRole('button', { name: 'Install agent' }).click();
    await expect(owner.page.getByTestId('installed-note')).toBeVisible();

    await owner.page.goto(`/teams/${wsId}`);
    const link = await inviteLink(owner.page);
    const member = await newUser(browser, 'worker');
    await member.page.goto(link);
    await member.page.getByRole('button', { name: 'Accept invite' }).click();
    await expect(member.page.getByTestId('team-title')).toHaveText('Main');

    // o membro executa pela biblioteca, sem instalar nada
    const item = member.page.getByTestId('lib-social-media-planner');
    await item.getByRole('button', { name: 'Run' }).click();
    await item.getByLabel('Topic').fill('quarterly launch');
    await item.getByRole('button', { name: 'Run agent' }).click();
    await expect(member.page).toHaveURL(/\/runs\/[0-9a-f-]+$/);
    await expect(member.page.getByTestId('run-status')).toHaveText('Awaiting approval');
    await expect(member.page.getByRole('button', { name: 'Approve and release' })).toHaveCount(0); // membro não decide
    await expect(member.page.getByTestId('approval-waiting')).toBeVisible();
    const runUrl = member.page.url();

    // o owner enxerga no histórico do workspace e na fila, e aprova
    await owner.page.goto(`/teams/${wsId}`);
    await expect(owner.page.getByTestId('history')).toContainText(member.email);
    await owner.page.goto(runUrl);
    await expect(owner.page.getByTestId('approval-card')).toBeVisible();
    await owner.page.getByRole('button', { name: 'Approve and release' }).click();
    await expect(owner.page.getByTestId('run-status')).toHaveText('Completed');
    await member.page.reload();
    await expect(member.page.getByTestId('run-status')).toHaveText('Completed');
    await owner.ctx.close();
    await member.ctx.close();
  });
});
