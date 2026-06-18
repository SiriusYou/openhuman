import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Workbench, { workbenchIdempotencyStorageKey } from './Workbench';

const mockClient = vi.hoisted(() => ({
  listAlerts: vi.fn(),
  ackAlert: vi.fn(),
  resolveAlert: vi.fn(),
}));

vi.mock('../services/api/coreWorkbenchClient', () => ({
  createCoreWorkbenchClient: () => mockClient,
}));

const baseAlert = {
  id: 'alert-1',
  alert_type: 'missed_checkin',
  severity: 'critical',
  related_type: 'task_instance',
  related_id: 'task-1',
  status: 'open',
  summary: 'Buddy missed a check-in.',
  created_at: '2026-06-01T00:00:00Z',
  acknowledged_at: null,
  resolved_at: null,
} as const;

function storedIdempotencyKeys() {
  const raw = window.localStorage.getItem(workbenchIdempotencyStorageKey);
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

describe('Workbench', () => {
  beforeEach(() => {
    mockClient.listAlerts.mockReset();
    mockClient.ackAlert.mockReset();
    mockClient.resolveAlert.mockReset();
    window.localStorage.clear();
  });

  it('renders alerts and deferred context placeholder', async () => {
    mockClient.listAlerts.mockResolvedValueOnce([baseAlert]);

    render(<Workbench />);

    expect(await screen.findByText('Buddy missed a check-in.')).toBeInTheDocument();
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText('missed_checkin')).toBeInTheDocument();
    expect(
      screen.getByText(/Pet, owner, latest check-in, and event trace context/i)
    ).toBeInTheDocument();
  });

  it('maps all filters to Core sentinel params instead of status=all', async () => {
    mockClient.listAlerts.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<Workbench />);
    await waitFor(() =>
      expect(mockClient.listAlerts).toHaveBeenCalledWith({ status: 'open', severity: undefined })
    );

    await user.selectOptions(screen.getByLabelText('Alert status filter'), 'all');
    await waitFor(() =>
      expect(mockClient.listAlerts).toHaveBeenLastCalledWith({ status: null, severity: undefined })
    );
    expect(mockClient.listAlerts).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'all' })
    );

    await user.selectOptions(screen.getByLabelText('Alert severity filter'), 'high');
    await waitFor(() =>
      expect(mockClient.listAlerts).toHaveBeenLastCalledWith({ status: null, severity: 'high' })
    );
  });

  it('persists ack idempotency keys across retry and remount', async () => {
    mockClient.listAlerts.mockResolvedValue([baseAlert]);
    mockClient.ackAlert.mockRejectedValue(new Error('temporary failure'));
    const user = userEvent.setup();

    const firstRender = render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(mockClient.ackAlert).toHaveBeenCalledTimes(1));
    const firstKey = mockClient.ackAlert.mock.calls[0]?.[1]?.idempotencyKey;
    expect(firstKey).toEqual(expect.stringContaining('youpet-workbench:ack:alert-1:'));
    expect(storedIdempotencyKeys()['ack:alert-1']).toBe(firstKey);

    firstRender.unmount();
    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(mockClient.ackAlert).toHaveBeenCalledTimes(2));

    expect(mockClient.ackAlert.mock.calls[1]?.[1]?.idempotencyKey).toBe(firstKey);
    expect(storedIdempotencyKeys()['ack:alert-1']).toBe(firstKey);
  });

  it('clears action keys only after success and refreshes visible alert state', async () => {
    const acknowledged = {
      ...baseAlert,
      status: 'acknowledged',
      acknowledged_at: '2026-06-01T01:00:00Z',
    } as const;
    mockClient.listAlerts.mockResolvedValueOnce([baseAlert]).mockResolvedValueOnce([acknowledged]);
    mockClient.ackAlert.mockResolvedValueOnce(acknowledged);
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await user.type(screen.getByLabelText('Ack note for alert-1'), 'Calling owner');
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));

    await waitFor(() => expect(mockClient.ackAlert).toHaveBeenCalledTimes(1));
    expect(mockClient.ackAlert).toHaveBeenCalledWith('alert-1', {
      note: 'Calling owner',
      idempotencyKey: expect.stringContaining('youpet-workbench:ack:alert-1:'),
    });
    await waitFor(() => expect(mockClient.listAlerts).toHaveBeenCalledTimes(2));
    expect(storedIdempotencyKeys()['ack:alert-1']).toBeUndefined();
    expect(await screen.findByText('acknowledged')).toBeInTheDocument();
  });

  it('disables both row actions while an alert action is pending', async () => {
    const acknowledged = {
      ...baseAlert,
      status: 'acknowledged',
      acknowledged_at: '2026-06-01T01:00:00Z',
    } as const;
    const pendingAck = deferred<typeof acknowledged>();
    mockClient.listAlerts.mockResolvedValue([baseAlert]);
    mockClient.ackAlert.mockReturnValueOnce(pendingAck.promise);
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    const ackButton = screen.getByRole('button', { name: 'Acknowledge' });
    const resolveButton = screen.getByRole('button', { name: 'Resolve' });

    await user.click(ackButton);
    await waitFor(() => expect(ackButton).toBeDisabled());
    expect(resolveButton).toBeDisabled();

    await user.click(resolveButton);
    expect(mockClient.resolveAlert).not.toHaveBeenCalled();

    pendingAck.resolve(acknowledged);
    await waitFor(() => expect(mockClient.ackAlert).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(ackButton).not.toBeDisabled());
  });

  it('keeps the original row locked when another alert starts an action', async () => {
    const secondAlert = {
      ...baseAlert,
      id: 'alert-2',
      related_id: 'task-2',
      severity: 'high',
      summary: 'Milo missed a check-in.',
    } as const;
    const acknowledged = {
      ...baseAlert,
      status: 'acknowledged',
      acknowledged_at: '2026-06-01T01:00:00Z',
    } as const;
    const resolvedSecond = {
      ...secondAlert,
      status: 'resolved',
      resolved_at: '2026-06-01T02:00:00Z',
    } as const;
    const pendingAck = deferred<typeof acknowledged>();
    const pendingResolve = deferred<typeof resolvedSecond>();
    mockClient.listAlerts.mockResolvedValue([baseAlert, secondAlert]);
    mockClient.ackAlert.mockReturnValueOnce(pendingAck.promise);
    mockClient.resolveAlert.mockReturnValueOnce(pendingResolve.promise);
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await screen.findByText('Milo missed a check-in.');

    const firstRow = screen.getByText('Buddy missed a check-in.').closest('article');
    const secondRow = screen.getByText('Milo missed a check-in.').closest('article');
    expect(firstRow).not.toBeNull();
    expect(secondRow).not.toBeNull();

    const firstAckButton = within(firstRow as HTMLElement).getByRole('button', {
      name: 'Acknowledge',
    });
    const firstResolveButton = within(firstRow as HTMLElement).getByRole('button', {
      name: 'Resolve',
    });
    const secondResolveButton = within(secondRow as HTMLElement).getByRole('button', {
      name: 'Resolve',
    });

    await user.click(firstAckButton);
    await waitFor(() => expect(firstResolveButton).toBeDisabled());

    await user.click(secondResolveButton);
    await waitFor(() => expect(secondResolveButton).toBeDisabled());
    expect(firstAckButton).toBeDisabled();
    expect(firstResolveButton).toBeDisabled();

    await user.click(firstResolveButton);
    expect(mockClient.resolveAlert).toHaveBeenCalledTimes(1);
    expect(mockClient.resolveAlert).toHaveBeenCalledWith(
      'alert-2',
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('youpet-workbench:resolve:alert-2:'),
      })
    );

    pendingAck.resolve(acknowledged);
    pendingResolve.resolve(resolvedSecond);
    await waitFor(() => expect(firstAckButton).not.toBeDisabled());
    await waitFor(() => expect(secondResolveButton).not.toBeDisabled());
  });

  it('keeps resolve key on failure and does not leak error details', async () => {
    mockClient.listAlerts.mockResolvedValue([baseAlert]);
    mockClient.resolveAlert.mockRejectedValue(new Error('svc-token leaked'));
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await user.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => expect(mockClient.resolveAlert).toHaveBeenCalledTimes(1));
    expect(storedIdempotencyKeys()['resolve:alert-1']).toEqual(
      mockClient.resolveAlert.mock.calls[0]?.[1]?.idempotencyKey
    );
    expect(
      screen.getByText('Workbench request failed. Check Core configuration and try again.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/svc-token/)).not.toBeInTheDocument();
  });
});
