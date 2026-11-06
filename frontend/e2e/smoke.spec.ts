import { test, expect } from '@playwright/test';

test.describe('public smoke', () => {
  test('landing loads brand', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText(/Mnemosyne/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('status page is honest', async ({ page }) => {
    await page.goto('/status');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Hosting|Firestore|Functions|Stripe/i).first()).toBeVisible();
    await expect(page.getByText(/Não verificado/i).first()).toBeVisible();
    await expect(page.getByText(/não mede a disponibilidade|does not measure live service availability/i).first()).toBeVisible();
  });

  test('security page exists', async ({ page }) => {
    await page.goto('/security');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/anexos.*Firebase Storage/i).first()).toBeVisible();
    await expect(page.getByText(/URL.*token/i).first()).toBeVisible();
  });

  test('privacy page discloses attachment limits', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByText(/Firebase Storage.*E2EE/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
