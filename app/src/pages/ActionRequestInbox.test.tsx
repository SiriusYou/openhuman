import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ActionRequestInbox, {
  actionRequestIdempotencyStorageKey,
} from './ActionRequestInbox';

const mockClient = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
}));

vi.mock('../services/api/coreActionRequestClient', async () => {
  const actual = await vi.importActual<typeof import('../services/api/coreActionRequestClient')>(
    '../services/api/coreActionRequestClient'
  );
  return {
    ...actual,
    createCoreActionRequestClient: () => mockClient,
  };
});

const PENDING_ID = '33333333-3333-4333-8333-333333333333';

const pendingItem = {
  action_request: {
    id: PENDING_ID,
    action_type: 'task.escalate',
    risk: 'high',
    proposer: { type: 'agent', id: 'openclaw-main' },
    target: { type: 'task', id: 'task-1' },
    policy: {
      reasons: ['high risk requires human approval'],
      obligations: ['notify owner after decision'],
    },
    payload: { summary: 'Escalate missed check-in' },
  },
  row_version: 2,
  id: PENDING_ID,
  tenant_id: '20000000-0000-0000-0000-000000000001',
  approval_state: 'pending',
  execution_state: 'not_started',
  policy_outcome: 'require_approval',
  correlation_id: 'corr_1',
  created_at: '2026-08-08T12:00:00Z',
  updated_at: '2026-08-08T12:00:00Z',
} as const;

function storedIdempotencyKeys() {
  const raw = window.localStorage.getItem(actionRequestIdempotencyStorageKey);
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function structuredError(code: string) {
  return {
    data: {
      kind: 'YouPetCoreHttpError',
      youpet: { code },
    },
  };
}

describe('ActionRequestInbox', () => {
  beforeEach(() => {
    mockClient.list.mockReset();
    mockClient.get.mockReset();
    mockClient.approve.mockReset();
    mockClient.reject.mockReset();
    window.localStorage.clear();
  });

  it('renders pending request context for operator review', async () => {
    mockClient.list.mockResolvedValueOnce([pendingItem]);

    render(<ActionRequestInbox />);

    expect(await screen.findByTestId(`action-request-row-${PENDING_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId('action-request-detail-id')).toHaveTextContent(PENDING_ID);
    expect(screen.getByTestId('action-request-detail')).toHaveTextContent('task.escalate');
    expect(screen.getByTestId('action-request-detail')).toHaveTextContent('high');
    expect(screen.getByText(/agent · openclaw-main/)).toBeInTheDocument();
    expect(screen.getByText(/task · task-1/)).toBeInTheDocument();
    expect(screen.getByText('high risk requires human approval')).toBeInTheDocument();
    expect(screen.getByText('notify owner after decision')).toBeInTheDocument();
    expect(screen.getByTestId('action-request-payload')).toHaveTextContent(
      'Escalate missed check-in'
    );
    expect(screen.getByTestId('action-request-approve')).toBeInTheDocument();
    expect(screen.getByTestId('action-request-reject')).toBeInTheDocument();
  });

  it('shows empty and error states', async () => {
    mockClient.list.mockResolvedValueOnce([]);
    const first = render(<ActionRequestInbox />);
    expect(await screen.findByTestId('action-request-empty')).toBeInTheDocument();
    first.unmount();

    mockClient.list.mockRejectedValueOnce(structuredError('forbidden'));
    render(<ActionRequestInbox />);
    expect(await screen.findByTestId('action-request-error')).toHaveTextContent('forbidden');
  });

  it('approves with reason, row version, and stable idempotency key', async () => {
    const approved = {
      ...pendingItem,
      approval_state: 'approved',
      row_version: 3,
    };
    mockClient.list.mockResolvedValue([pendingItem]);
    mockClient.approve.mockResolvedValueOnce(approved);
    const user = userEvent.setup();

    render(<ActionRequestInbox />);
    await screen.findByTestId(`action-request-row-${PENDING_ID}`);
    await user.type(screen.getByTestId('action-request-reason'), 'safe to proceed');
    await user.click(screen.getByTestId('action-request-approve'));

    await waitFor(() => expect(mockClient.approve).toHaveBeenCalledTimes(1));
    expect(mockClient.approve).toHaveBeenCalledWith(PENDING_ID, {
      reason: 'safe to proceed',
      expectedRowVersion: 2,
      idempotencyKey: expect.stringContaining(`youpet-action-request:approve:${PENDING_ID}:`),
    });
    expect(storedIdempotencyKeys()[`approve:${PENDING_ID}`]).toBeUndefined();
    expect(await screen.findByTestId('action-request-terminal')).toBeInTheDocument();
  });

  it('rejects with reason and expected row version', async () => {
    const rejected = {
      ...pendingItem,
      approval_state: 'rejected',
      row_version: 3,
    };
    mockClient.list.mockResolvedValue([pendingItem]);
    mockClient.reject.mockResolvedValueOnce(rejected);
    const user = userEvent.setup();

    render(<ActionRequestInbox />);
    await screen.findByTestId(`action-request-row-${PENDING_ID}`);
    await user.type(screen.getByTestId('action-request-reason'), 'too risky');
    await user.click(screen.getByTestId('action-request-reject'));

    await waitFor(() => expect(mockClient.reject).toHaveBeenCalledTimes(1));
    expect(mockClient.reject).toHaveBeenCalledWith(PENDING_ID, {
      reason: 'too risky',
      expectedRowVersion: 2,
      idempotencyKey: expect.stringContaining(`youpet-action-request:reject:${PENDING_ID}:`),
    });
    expect(storedIdempotencyKeys()[`reject:${PENDING_ID}`]).toBeUndefined();
  });

  it('reuses the same approve idempotency key across failed retry and remount', async () => {
    mockClient.list.mockResolvedValue([pendingItem]);
    mockClient.approve.mockRejectedValue(new Error('temporary failure'));
    const user = userEvent.setup();

    const firstRender = render(<ActionRequestInbox />);
    await screen.findByTestId(`action-request-row-${PENDING_ID}`);
    await user.type(screen.getByTestId('action-request-reason'), 'retry me');
    await user.click(screen.getByTestId('action-request-approve'));
    await waitFor(() => expect(mockClient.approve).toHaveBeenCalledTimes(1));
    const firstKey = mockClient.approve.mock.calls[0]?.[1]?.idempotencyKey as string;
    expect(firstKey).toEqual(
      expect.stringContaining(`youpet-action-request:approve:${PENDING_ID}:`)
    );
    expect(storedIdempotencyKeys()[`approve:${PENDING_ID}`]).toBe(firstKey);

    firstRender.unmount();
    render(<ActionRequestInbox />);
    await screen.findByTestId(`action-request-row-${PENDING_ID}`);
    await user.type(screen.getByTestId('action-request-reason'), 'retry me');
    await user.click(screen.getByTestId('action-request-approve'));
    await waitFor(() => expect(mockClient.approve).toHaveBeenCalledTimes(2));
    expect(mockClient.approve.mock.calls[1]?.[1]?.idempotencyKey).toBe(firstKey);
  });

  it('does not reuse an approve key for reject', async () => {
    mockClient.list.mockResolvedValue([pendingItem]);
    mockClient.approve.mockRejectedValueOnce(new Error('temporary failure'));
    mockClient.reject.mockRejectedValueOnce(new Error('temporary failure'));
    const user = userEvent.setup();

    render(<ActionRequestInbox />);
    await screen.findByTestId(`action-request-row-${PENDING_ID}`);
    await user.type(screen.getByTestId('action-request-reason'), 'decision reason');
    await user.click(screen.getByTestId('action-request-approve'));
    await waitFor(() => expect(mockClient.approve).toHaveBeenCalledTimes(1));
    const approveKey = mockClient.approve.mock.calls[0]?.[1]?.idempotencyKey as string;

    await user.click(screen.getByTestId('action-request-reject'));
    await waitFor(() => expect(mockClient.reject).toHaveBeenCalledTimes(1));
    const rejectKey = mockClient.reject.mock.calls[0]?.[1]?.idempotencyKey as string;
    expect(rejectKey).not.toBe(approveKey);
    expect(rejectKey).toEqual(
      expect.stringContaining(`youpet-action-request:reject:${PENDING_ID}:`)
    );
    expect(storedIdempotencyKeys()[`approve:${PENDING_ID}`]).toBe(approveKey);
    expect(storedIdempotencyKeys()[`reject:${PENDING_ID}`]).toBe(rejectKey);
  });

  it('suppresses duplicate in-flight approve clicks', async () => {
    const approved = {
      ...pendingItem,
      approval_state: 'approved',
      row_version: 3,
    };
    const pendingApprove = deferred<typeof approved>();
    mockClient.list.mockResolvedValue([pendingItem]);
    mockClient.approve.mockReturnValueOnce(pendingApprove.promise);
    const user = userEvent.setup();

    render(<ActionRequestInbox />);
    await screen.findByTestId(`action-request-row-${PENDING_ID}`);
    await user.type(screen.getByTestId('action-request-reason'), 'one click only');
    const approveButton = screen.getByTestId('action-request-approve');
    const rejectButton = screen.getByTestId('action-request-reject');

    await user.click(approveButton);
    await waitFor(() => expect(approveButton).toBeDisabled());
    expect(rejectButton).toBeDisabled();
    await user.click(approveButton);
    await user.click(rejectButton);
    expect(mockClient.approve).toHaveBeenCalledTimes(1);
    expect(mockClient.reject).not.toHaveBeenCalled();

    pendingApprove.resolve(approved);
    await waitFor(() => expect(screen.getByTestId('action-request-terminal')).toBeInTheDocument());
  });

  it('reloads Core state on concurrency conflict and explains the conflict', async () => {
    const refreshed = {
      ...pendingItem,
      approval_state: 'approved',
      row_version: 4,
    };
    mockClient.list.mockResolvedValue([pendingItem]);
    mockClient.approve.mockRejectedValueOnce(structuredError('concurrency_conflict'));
    mockClient.get.mockResolvedValueOnce(refreshed);
    const user = userEvent.setup();

    render(<ActionRequestInbox />);
    await screen.findByTestId(`action-request-row-${PENDING_ID}`);
    await user.type(screen.getByTestId('action-request-reason'), 'race');
    await user.click(screen.getByTestId('action-request-approve'));

    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith(PENDING_ID));
    expect(await screen.findByTestId('action-request-error')).toHaveTextContent(
      'concurrency_conflict'
    );
    expect(screen.getByTestId('action-request-error')).toHaveTextContent('approved');
    expect(screen.getByTestId('action-request-error')).toHaveTextContent('v4');
    expect(screen.getByTestId('action-request-terminal')).toBeInTheDocument();
    expect(storedIdempotencyKeys()[`approve:${PENDING_ID}`]).toBeUndefined();
  });

  it('keeps the same-intent key when conflict leaves the row pending', async () => {
    const stillPending = {
      ...pendingItem,
      row_version: 3,
    };
    mockClient.list.mockResolvedValue([pendingItem]);
    mockClient.approve.mockRejectedValueOnce(structuredError('concurrency_conflict'));
    mockClient.get.mockResolvedValueOnce(stillPending);
    const user = userEvent.setup();

    render(<ActionRequestInbox />);
    await screen.findByTestId(`action-request-row-${PENDING_ID}`);
    await user.type(screen.getByTestId('action-request-reason'), 'retry later');
    await user.click(screen.getByTestId('action-request-approve'));

    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith(PENDING_ID));
    const storedKey = storedIdempotencyKeys()[`approve:${PENDING_ID}`];
    expect(storedKey).toEqual(
      expect.stringContaining(`youpet-action-request:approve:${PENDING_ID}:`)
    );

    mockClient.approve.mockResolvedValueOnce({
      ...stillPending,
      approval_state: 'approved',
      row_version: 4,
    });
    await user.click(screen.getByTestId('action-request-approve'));
    await waitFor(() => expect(mockClient.approve).toHaveBeenCalledTimes(2));
    expect(mockClient.approve.mock.calls[1]?.[1]?.idempotencyKey).toBe(storedKey);
  });

  it('hides decision controls for terminal approvals', async () => {
    mockClient.list.mockResolvedValueOnce([
      {
        ...pendingItem,
        approval_state: 'rejected',
        row_version: 5,
      },
    ]);

    render(<ActionRequestInbox />);
    expect(await screen.findByTestId('action-request-terminal')).toBeInTheDocument();
    expect(screen.queryByTestId('action-request-approve')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-request-reject')).not.toBeInTheDocument();
  });

  it('requires a non-empty reason before submitting', async () => {
    mockClient.list.mockResolvedValue([pendingItem]);
    const user = userEvent.setup();

    render(<ActionRequestInbox />);
    await screen.findByTestId(`action-request-row-${PENDING_ID}`);
    await user.click(screen.getByTestId('action-request-approve'));

    expect(await screen.findByTestId('action-request-error')).toHaveTextContent(
      'non-empty operator reason'
    );
    expect(mockClient.approve).not.toHaveBeenCalled();
  });
});
