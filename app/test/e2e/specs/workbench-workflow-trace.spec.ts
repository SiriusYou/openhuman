// @ts-nocheck
/**
 * M1.3.2 / youpet-core#15 — committed-code operator acceptance.
 *
 * The companion root harness starts a disposable PostgreSQL cluster and a
 * live YouPet Core. This spec then drives the built Tauri/CEF application,
 * so every assertion crosses the production React -> Tauri RPC -> Rust HTTP
 * bridge instead of replacing that boundary with a browser mock.
 */
import { waitForApp } from '../helpers/app-helpers';
import { captureCheckpoint } from '../helpers/artifacts';
import { resetApp } from '../helpers/reset-app';
import { navigateViaHash } from '../helpers/shared-flows';
import { startMockServer, stopMockServer } from '../mock-server';

const USER_ID = 'e2e-m132-workflow-trace';
const TASK_ALERT_SUMMARY = 'Owner missed two check-ins.';
const PARTIAL_ALERT_SUMMARY = 'Unsupported workflow anchor.';

async function waitForArticle(summary: string, timeout = 20_000): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((targetSummary: string) => {
        return Array.from(document.querySelectorAll('article')).some(article =>
          (article.textContent ?? '').includes(targetSummary)
        );
      }, summary),
    {
      timeout,
      interval: 250,
      timeoutMsg: `workbench article "${summary}" did not appear`,
    }
  );
}

async function openTraceForArticle(summary: string): Promise<void> {
  await waitForArticle(summary);
  const opened = await browser.execute(target => {
    const article = Array.from(document.querySelectorAll('article')).find(candidate =>
      (candidate.textContent ?? '').includes(target)
    );
    const traceButton = Array.from(article?.querySelectorAll('button') ?? []).find(
      button => button.textContent?.trim() === 'Trace'
    );
    traceButton?.click();
    return Boolean(traceButton);
  }, summary);
  expect(opened).toBe(true);

  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return Boolean(dialog && !(dialog.textContent ?? '').includes('Loading trace'));
      }),
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: `trace drawer for "${summary}" did not finish loading`,
    }
  );
}

async function closeTrace(): Promise<void> {
  const closed = await browser.execute(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const closeButton = Array.from(dialog?.querySelectorAll('button') ?? []).find(
      button => button.textContent?.trim() === 'Close'
    );
    closeButton?.click();
    return Boolean(closeButton);
  });
  expect(closed).toBe(true);
  await browser.$('[role="dialog"]').waitForExist({ timeout: 5_000, reverse: true });
}

describe('M1.3.2 workflow trace operator acceptance', function () {
  this.timeout(120_000);

  before(async function beforeSuite() {
    await startMockServer(Number(process.env.E2E_MOCK_PORT || 18473));
    await waitForApp();
    await resetApp(USER_ID);
  });

  after(async () => {
    await stopMockServer();
  });

  it('shows workflow failure, retry, recovery, provenance, and bounded metadata read-only', async function () {
    this.timeout(120_000);
    await navigateViaHash('/workbench');
    await waitForArticle(TASK_ALERT_SUMMARY);

    await openTraceForArticle(TASK_ALERT_SUMMARY);
    const traceState = await browser.execute(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const text = dialog?.textContent ?? '';
      const buttons = Array.from(dialog?.querySelectorAll('button') ?? []).map(button =>
        button.textContent?.trim()
      );
      return { text, buttons };
    });

    expect(traceState.text).toContain('Workflow summary');
    for (const lane of ['Step', 'Event', 'Delivery', 'Audit']) {
      expect(traceState.text).toContain(lane);
    }
    expect(traceState.text).toContain('Failed · Retry scheduled');
    expect(traceState.text).toContain('Recovered');
    expect(traceState.text).toContain('correlation_id');
    expect(traceState.text).toContain('corr_seed');
    expect(traceState.text).toContain('Actor');
    expect(traceState.text).toContain('Related');

    expect(traceState.buttons).toEqual(['Close', 'Refresh trace']);
    expect(traceState.text).not.toContain('dev-openhuman-token');
    expect(traceState.text).not.toContain('raw_secret');
    expect(traceState.text).not.toContain('service_token');
    for (const mutation of ['Retry', 'Redrive', 'Approve', 'Reject']) {
      expect(traceState.buttons).not.toContain(mutation);
    }

    await captureCheckpoint('m132-workflow-summary');
    const scrolledToFailure = await browser.execute(() => {
      const failureEntry = Array.from(document.querySelectorAll('li')).find(entry =>
        (entry.textContent ?? '').includes('Failed · Retry scheduled')
      );
      failureEntry?.scrollIntoView({ block: 'center' });
      return Boolean(failureEntry);
    });
    expect(scrolledToFailure).toBe(true);
    await browser.pause(250);
    await captureCheckpoint('m132-workflow-failure-recovery');
    await closeTrace();
  });

  it('surfaces an unsupported anchor as an explicit partial trace warning', async function () {
    this.timeout(90_000);
    await openTraceForArticle(PARTIAL_ALERT_SUMMARY);

    const partialState = await browser.execute(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return {
        text: dialog?.textContent ?? '',
        buttons: Array.from(dialog?.querySelectorAll('button') ?? []).map(button =>
          button.textContent?.trim()
        ),
      };
    });

    expect(partialState.text).toContain('Workflow identity is unavailable for this alert.');
    expect(partialState.text).toContain('Unsupported Related Type');
    expect(partialState.text).toContain(
      'trace projection does not support related_type operator_fixture'
    );
    expect(partialState.buttons).toEqual(['Close', 'Refresh trace']);
    await captureCheckpoint('m132-explicit-partial-warning');
  });
});
