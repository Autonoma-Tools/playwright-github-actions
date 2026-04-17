#!/usr/bin/env node
// Poll a PaaS deployment API until a preview is live, then emit the URL to
// $GITHUB_OUTPUT so a follow-up Actions step can run Playwright against it.
//
// Required env:
//   PLATFORM    one of: railway | render | netlify
//   API_TOKEN   platform API token (stored as a GH Actions secret)
//   PROJECT_ID  platform-specific project / service / site identifier
//   BRANCH      branch name to match against deployments
//
// Optional env:
//   TIMEOUT_MS       default 600000 (10 minutes)
//   INITIAL_POLL_MS  default 10000
//   BACKOFF_POLL_MS  default 30000
//   GITHUB_OUTPUT    provided automatically by GitHub Actions
//
// Exit codes:
//   0 on success (and `url=...` written to $GITHUB_OUTPUT)
//   1 on deploy failure, timeout, or missing config
//
// Uses Node 18+ global fetch. No external dependencies.

'use strict';

const fs = require('node:fs');

const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 10 * 60 * 1000);
const INITIAL_POLL_MS = Number(process.env.INITIAL_POLL_MS || 10_000);
const BACKOFF_POLL_MS = Number(process.env.BACKOFF_POLL_MS || 30_000);
const FIRST_MINUTE_MS = 60_000;
const NOT_FOUND_GRACE_MS = 60_000;
const HEALTH_CHECK_TIMEOUT_MS = 5 * 60 * 1000;

function fail(message) {
  console.error(`[wait-for-deployment] ERROR: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[wait-for-deployment] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    log(`GITHUB_OUTPUT not set; printing ${key}=${value} to stdout instead.`);
    console.log(`${key}=${value}`);
    return;
  }
  fs.appendFileSync(file, `${key}=${value}\n`);
}

// Normalized deployment shape returned by every platform adapter:
//   { status: 'building' | 'ready' | 'failed' | 'not_found', url: string | null, raw?: unknown }

async function fetchRailway({ apiToken, projectId, branch }) {
  // Railway exposes a GraphQL endpoint at https://backboard.railway.app/graphql/v2.
  // We query the most recent deployments on the given project + branch.
  const query = `
    query Deployments($projectId: String!) {
      deployments(input: { projectId: $projectId }, first: 20) {
        edges {
          node {
            id
            status
            staticUrl
            meta
            createdAt
          }
        }
      }
    }
  `;
  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({ query, variables: { projectId } }),
  });
  if (res.status === 404) return { status: 'not_found', url: null };
  if (!res.ok) throw new Error(`Railway API ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const edges = body?.data?.deployments?.edges ?? [];
  const match = edges
    .map((e) => e.node)
    .find((n) => {
      const metaBranch = n?.meta?.branch ?? n?.meta?.gitBranch;
      return metaBranch === branch;
    });
  if (!match) return { status: 'not_found', url: null };

  const status = String(match.status || '').toUpperCase();
  if (status === 'SUCCESS' || status === 'DEPLOYED') {
    return { status: 'ready', url: match.staticUrl || null, raw: match };
  }
  if (status === 'FAILED' || status === 'CRASHED' || status === 'REMOVED') {
    return { status: 'failed', url: null, raw: match };
  }
  return { status: 'building', url: null, raw: match };
}

async function fetchRender({ apiToken, projectId, branch }) {
  // Render: list deploys for a service, filter by branch.
  const url = `https://api.render.com/v1/services/${encodeURIComponent(projectId)}/deploys?limit=20`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  });
  if (res.status === 404) return { status: 'not_found', url: null };
  if (!res.ok) throw new Error(`Render API ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const deploys = Array.isArray(body) ? body.map((d) => d.deploy ?? d) : [];
  const match = deploys.find((d) => {
    const commitBranch = d?.commit?.branch ?? d?.branch;
    return commitBranch === branch;
  });
  if (!match) return { status: 'not_found', url: null };

  const status = String(match.status || '').toLowerCase();
  if (status === 'live' || status === 'succeeded') {
    return { status: 'ready', url: match.url || match.serviceUrl || null, raw: match };
  }
  if (
    status === 'build_failed' ||
    status === 'update_failed' ||
    status === 'canceled' ||
    status === 'deactivated'
  ) {
    return { status: 'failed', url: null, raw: match };
  }
  return { status: 'building', url: null, raw: match };
}

async function fetchNetlify({ apiToken, projectId, branch }) {
  // Netlify: list deploys for a site, filter by branch.
  const url = `https://api.netlify.com/api/v1/sites/${encodeURIComponent(projectId)}/deploys?branch=${encodeURIComponent(branch)}&per_page=20`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  });
  if (res.status === 404) return { status: 'not_found', url: null };
  if (!res.ok) throw new Error(`Netlify API ${res.status}: ${await res.text()}`);
  const deploys = await res.json();
  const match = Array.isArray(deploys) ? deploys[0] : null;
  if (!match) return { status: 'not_found', url: null };

  const state = String(match.state || '').toLowerCase();
  if (state === 'ready') {
    const deployUrl = match.deploy_ssl_url || match.deploy_url || match.ssl_url || match.url;
    return { status: 'ready', url: deployUrl || null, raw: match };
  }
  if (state === 'error' || state === 'rejected') {
    return { status: 'failed', url: null, raw: match };
  }
  return { status: 'building', url: null, raw: match };
}

function getAdapter(platform) {
  switch (platform) {
    case 'railway':
      return fetchRailway;
    case 'render':
      return fetchRender;
    case 'netlify':
      return fetchNetlify;
    default:
      return null;
  }
}

async function waitForHealthy(url) {
  // Once the platform says the deploy is ready, the edge may still be warming
  // up and return 503 for a few seconds. Poll the URL until it returns a
  // non-5xx status or we give up.
  const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow' });
      lastStatus = res.status;
      if (res.status < 500) {
        log(`URL healthy (HTTP ${res.status}): ${url}`);
        return;
      }
      log(`URL warming up (HTTP ${res.status}); retrying in 5s...`);
    } catch (err) {
      log(`URL not reachable yet (${err.message}); retrying in 5s...`);
    }
    await sleep(5000);
  }
  throw new Error(`URL ${url} never returned a non-5xx response (last status: ${lastStatus}).`);
}

async function main() {
  const { PLATFORM, API_TOKEN, PROJECT_ID, BRANCH } = process.env;

  if (!PLATFORM || !API_TOKEN || !PROJECT_ID || !BRANCH) {
    fail('Missing required env. Need PLATFORM, API_TOKEN, PROJECT_ID, BRANCH.');
  }

  const adapter = getAdapter(PLATFORM);
  if (!adapter) {
    fail(`Unsupported PLATFORM '${PLATFORM}'. Supported: railway, render, netlify.`);
  }

  log(`Platform: ${PLATFORM}`);
  log(`Project:  ${PROJECT_ID}`);
  log(`Branch:   ${BRANCH}`);
  log(`Timeout:  ${TIMEOUT_MS} ms`);

  const startedAt = Date.now();
  let notFoundSince = null;

  while (Date.now() - startedAt < TIMEOUT_MS) {
    const elapsed = Date.now() - startedAt;
    const pollInterval = elapsed < FIRST_MINUTE_MS ? INITIAL_POLL_MS : BACKOFF_POLL_MS;

    let result;
    try {
      result = await adapter({ apiToken: API_TOKEN, projectId: PROJECT_ID, branch: BRANCH });
    } catch (err) {
      log(`Poll error (will retry): ${err.message}`);
      await sleep(pollInterval);
      continue;
    }

    if (result.status === 'ready') {
      if (!result.url) fail('Platform reported ready but returned no URL.');
      log(`Deploy ready: ${result.url}`);
      await waitForHealthy(result.url);
      emitOutput('url', result.url);
      log('Done.');
      process.exit(0);
    }

    if (result.status === 'failed') {
      fail(`Deploy failed on ${PLATFORM}. Raw: ${JSON.stringify(result.raw ?? {})}`);
    }

    if (result.status === 'not_found') {
      if (notFoundSince === null) notFoundSince = Date.now();
      const notFoundFor = Date.now() - notFoundSince;
      if (notFoundFor > NOT_FOUND_GRACE_MS) {
        fail(`No deployment found for branch '${BRANCH}' after ${Math.round(notFoundFor / 1000)}s.`);
      }
      log(`No deployment yet for branch '${BRANCH}'; retrying in ${pollInterval / 1000}s...`);
    } else {
      notFoundSince = null;
      log(`Deploy building; retrying in ${pollInterval / 1000}s...`);
    }

    await sleep(pollInterval);
  }

  fail(`Timed out after ${TIMEOUT_MS}ms waiting for a ready deployment on ${PLATFORM}.`);
}

main().catch((err) => {
  fail(err.stack || err.message || String(err));
});
