// @ts-check
// Playwright config shared across all three CI levels in this repo:
//   Level 1 (localhost):      BASE_URL falls back to http://localhost:3000
//   Level 2 (static URL):     BASE_URL is injected from a secret
//   Level 3 (preview URL):    BASE_URL is injected from deployment_status.target_url
//
// Optional: set PLAYWRIGHT_EXTRA_HTTP_HEADERS to a JSON-encoded object to
// inject auth headers (e.g. {"Authorization":"Bearer xyz"}) for protected
// staging environments.
const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CI = !!process.env.CI;

/**
 * Parse PLAYWRIGHT_EXTRA_HTTP_HEADERS if set. Ignore empty strings and log
 * (but don't throw) on malformed JSON so a bad secret doesn't nuke the run
 * before it even starts.
 */
function parseExtraHeaders() {
  const raw = process.env.PLAYWRIGHT_EXTRA_HTTP_HEADERS;
  if (!raw || raw.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    console.warn('[playwright.config] PLAYWRIGHT_EXTRA_HTTP_HEADERS is not a JSON object; ignoring.');
    return undefined;
  } catch (err) {
    console.warn(`[playwright.config] Failed to parse PLAYWRIGHT_EXTRA_HTTP_HEADERS: ${err.message}`);
    return undefined;
  }
}

const extraHTTPHeaders = parseExtraHeaders();

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(extraHTTPHeaders ? { extraHTTPHeaders } : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
