# How to Run Playwright Tests in GitHub Actions (With Preview Environment Support)

Companion code for the Autonoma blog post 'How to Run Playwright Tests in GitHub Actions (With Preview Environment Support)'. Three production-ready GitHub Actions workflows (localhost, static URL, dynamic preview URL), a platform-agnostic deployment polling script, a ready-to-use playwright.config.js, and a smoke spec that works across all three levels.

> Companion code for the Autonoma blog post: **[How to Run Playwright Tests in GitHub Actions (With Preview Environment Support)](https://getautonoma.com/blog/playwright-github-actions)**

## Requirements

Node 18+ (for the polling script's global fetch), a GitHub repository with Actions enabled, and Playwright installed. For Level 2: a stable staging URL. For Level 3: a platform that supports preview deployments (Vercel, Railway, Render, or Netlify) and the appropriate API token stored as a GitHub Actions secret.

## Quickstart

```bash
git clone https://github.com/Autonoma-Tools/playwright-github-actions.git
cd playwright-github-actions
1. Clone this repo or copy the files you need into your own project. 2. Install Playwright: npm init playwright@latest. 3. Copy the workflow you want from .github/workflows/ into your own repo at the same path. 4. For Level 2/3, add the required secrets to your GitHub repo settings (see the comment block at the top of each workflow). 5. Push to a branch and open a PR to verify the workflow runs.
```

## Project structure

```
.
├── .github/
│   └── workflows/
│       ├── autonoma-test-runner.yml      # Autonoma-managed E2E on Vercel previews
│       ├── playwright-localhost.yml      # Level 1: localhost dev server
│       ├── playwright-preview-url.yml    # Level 3: Vercel preview URL
│       └── playwright-static-url.yml     # Level 2: static staging URL
├── scripts/
│   └── wait-for-deployment.js            # Polls Railway / Render / Netlify for a preview URL
├── tests/
│   └── smoke.spec.js                     # Minimal cross-level smoke spec
├── LICENSE
├── README.md
├── package.json
└── playwright.config.js                  # Shared across all three CI levels
```

- `.github/workflows/` — the three CI levels plus the Autonoma test-runner alternative.
- `scripts/` — the deployment polling helper for platforms that don't fire `deployment_status`.
- `tests/` — runnable Playwright specs you can execute as-is.

## About

This repository is maintained by [Autonoma](https://getautonoma.com) as reference material for the linked blog post. Autonoma builds autonomous AI agents that plan, execute, and maintain end-to-end tests directly from your codebase.

If something here is wrong, out of date, or unclear, please [open an issue](https://github.com/Autonoma-Tools/playwright-github-actions/issues/new).

## License

Released under the [MIT License](./LICENSE) © 2026 Autonoma Labs.
