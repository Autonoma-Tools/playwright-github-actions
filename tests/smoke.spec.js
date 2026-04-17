// @ts-check
// Minimal smoke spec — works against any of the three CI levels (localhost,
// static staging URL, preview URL) as long as playwright.config.js has been
// given a BASE_URL.
//
// Run locally: `npx playwright test tests/smoke.spec.js`
const { test, expect } = require('@playwright/test');

test.describe('smoke', () => {
  test('homepage loads', async ({ page }) => {
    await test.step('navigate to / and get a 200', async () => {
      const [response] = await Promise.all([
        page.waitForResponse(
          (res) => {
            if (res.request().resourceType() !== 'document') return false;
            const url = new URL(res.url());
            return url.pathname === '/' || url.pathname === '';
          },
          { timeout: 30_000 },
        ),
        page.goto('/', { waitUntil: 'domcontentloaded' }),
      ]);
      expect(response.status(), `HTTP ${response.status()} for /`).toBe(200);
    });

    await test.step('has a non-empty title', async () => {
      const title = await page.title();
      expect(title.trim().length, 'page title should not be empty').toBeGreaterThan(0);
    });
  });

  test('health endpoint responds if present', async ({ request, baseURL }) => {
    let response;
    try {
      response = await request.get('/health', { failOnStatusCode: false });
    } catch (err) {
      test.skip(true, `Could not reach ${baseURL}/health: ${err.message}`);
      return;
    }

    if (response.status() === 404) {
      test.skip(true, 'No /health endpoint on this deployment; skipping.');
      return;
    }

    expect.soft(response.status(), '/health should return 200').toBe(200);
    expect(response.ok(), '/health should be an OK response').toBeTruthy();
  });
});
