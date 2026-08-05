import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Workbench, { workbenchIdempotencyStorageKey } from './Workbench';

const mockClient = vi.hoisted(() => ({
  listAlerts: vi.fn(),
  ackAlert: vi.fn(),
  resolveAlert: vi.fn(),
  getAlertTrace: vi.fn(),
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
  context: {
    pet: {
      id: 'pet-1',
      name: 'Mochi',
      species: 'cat',
      breed: 'Exotic Shorthair',
      status: 'active',
    },
    owner: { id: 'owner-1', name: 'Owner A', phone: '18800000001', status: 'active' },
    health_plan: {
      id: 'plan-1',
      title: 'Daily check-in',
      plan_type: 'checkin',
      status: 'active',
      openclaw_flow_id: 'flow-plan-1',
    },
    task: {
      id: 'task-1',
      status: 'missed',
      due_at: '2026-06-01T10:01:00Z',
      missed_count: 2,
      openclaw_flow_id: 'flow-task-1',
    },
    latest_checkin: {
      id: 'checkin-1',
      submitted_at: '2026-06-01T10:10:00Z',
      submitted_by: 'owner-1',
      text: 'Looks normal.',
      status_tags: ['normal'],
    },
  },
} as const;

const baseTrace = {
  alert_id: 'alert-1',
  workflow: {
    type: 'health_plan',
    id: 'plan-1',
    task_id: 'task-1',
    openclaw_flow_id: 'flow-plan-1',
  },
  partial: true,
  warnings: [
    { code: 'trace_truncated', message: 'Trace limited to 50 entries', source: 'event_outbox' },
  ],
  entries: [
    {
      id: 'health-plan:plan-1:state',
      occurred_at: '2026-05-31T23:59:00Z',
      kind: 'health_plan_state',
      source: 'health_plans',
      title: 'Health plan active',
      detail: 'Daily check-in',
      actor: null,
      related_type: 'health_plan',
      related_id: 'plan-1',
      severity: null,
      metadata: { status: 'active' },
    },
    {
      id: 'alert:alert-1',
      occurred_at: '2026-06-01T00:00:00Z',
      kind: 'alert_created',
      source: 'alerts',
      title: 'Alert created',
      detail: 'Critical missed check-in alert.',
      actor: { type: 'system', id: 'core' },
      related_type: 'task_instance',
      related_id: 'task-1',
      severity: 'critical',
      metadata: { alert_type: 'missed_checkin', tags: ['late', 'critical'] },
    },
    {
      id: 'audit:nack-1',
      occurred_at: '2026-06-01T00:01:00Z',
      kind: 'delivery_failed',
      source: 'audit_logs',
      title: 'Delivery failed; retry scheduled',
      detail: 'provider timeout',
      actor: { type: 'agent', id: 'openclaw-youpet-consumer' },
      related_type: 'event_outbox',
      related_id: 'event-1',
      severity: null,
      metadata: { consumer: 'openclaw', attempts: 1 },
    },
    {
      id: 'audit:ack-1',
      occurred_at: '2026-06-01T00:02:00Z',
      kind: 'delivery_succeeded',
      source: 'audit_logs',
      title: 'Delivery succeeded',
      detail: null,
      actor: { type: 'agent', id: 'openclaw-youpet-consumer' },
      related_type: 'event_outbox',
      related_id: 'event-2',
      severity: null,
      metadata: { consumer: 'openclaw', attempts: 0, recovered: false },
    },
    {
      id: 'audit:ack-2',
      occurred_at: '2026-06-01T00:03:00Z',
      kind: 'delivery_recovered',
      source: 'audit_logs',
      title: 'Delivery recovered',
      detail: null,
      actor: { type: 'agent', id: 'openclaw-youpet-consumer' },
      related_type: 'event_outbox',
      related_id: 'event-1',
      severity: null,
      metadata: { consumer: 'openclaw', attempts: 1, recovered: true },
    },
  ],
};

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
    mockClient.getAlertTrace.mockReset();
    window.localStorage.clear();
  });

  it('renders alerts with operational context', async () => {
    mockClient.listAlerts.mockResolvedValueOnce([baseAlert]);

    render(<Workbench />);

    expect(await screen.findByText('Buddy missed a check-in.')).toBeInTheDocument();
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText('missed_checkin')).toBeInTheDocument();
    expect(screen.getByText('Mochi')).toBeInTheDocument();
    expect(screen.getByText('Owner A')).toBeInTheDocument();
    expect(screen.getByText('Daily check-in')).toBeInTheDocument();
    expect(screen.getAllByText(/flow-plan-1/i)).toHaveLength(1);
    expect(screen.getAllByText(/flow-task-1/i)).toHaveLength(1);
    expect(screen.getByText('Looks normal.')).toBeInTheDocument();
    expect(screen.getByText(/· normal/)).toBeInTheDocument();
  });

  it('renders unavailable context per row when Core returns null context', async () => {
    mockClient.listAlerts.mockResolvedValueOnce([{ ...baseAlert, context: null }]);

    render(<Workbench />);

    expect(await screen.findByText('Buddy missed a check-in.')).toBeInTheDocument();
    expect(screen.getByText('Operational context unavailable for this alert.')).toBeInTheDocument();
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

  it('preserves existing context when an action response is plain and refresh fails', async () => {
    const plainAcknowledged = {
      id: baseAlert.id,
      alert_type: baseAlert.alert_type,
      severity: baseAlert.severity,
      related_type: baseAlert.related_type,
      related_id: baseAlert.related_id,
      status: 'acknowledged',
      summary: baseAlert.summary,
      created_at: baseAlert.created_at,
      acknowledged_at: '2026-06-01T01:00:00Z',
      resolved_at: null,
    } as const;
    mockClient.listAlerts
      .mockResolvedValueOnce([baseAlert])
      .mockRejectedValueOnce(new Error('refresh failed'));
    mockClient.ackAlert.mockResolvedValueOnce(plainAcknowledged);
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));

    await waitFor(() => expect(mockClient.ackAlert).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockClient.listAlerts).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('acknowledged')).toBeInTheDocument();
    expect(screen.getByText('Mochi')).toBeInTheDocument();
    expect(screen.getByText('Daily check-in')).toBeInTheDocument();
    expect(
      screen.queryByText('Operational context unavailable for this alert.')
    ).not.toBeInTheDocument();
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

  it('opens trace drawer and renders timeline entries with warnings', async () => {
    mockClient.listAlerts.mockResolvedValue([baseAlert]);
    mockClient.getAlertTrace.mockResolvedValueOnce(baseTrace);
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await user.click(screen.getByRole('button', { name: 'Trace' }));

    expect(mockClient.getAlertTrace).toHaveBeenCalledWith('alert-1');
    const drawer = await screen.findByRole('dialog', { name: 'Workflow trace for alert-1' });
    const workflowSummary = within(drawer).getByRole('region', { name: 'Workflow summary' });
    expect(workflowSummary).toBeInTheDocument();
    expect(within(drawer).getAllByText('Daily check-in').length).toBeGreaterThan(0);
    expect(workflowSummary).toHaveTextContent('flow-plan-1');
    expect(within(drawer).getByText('Alert created')).toBeInTheDocument();
    expect(within(drawer).getByText('Critical missed check-in alert.')).toBeInTheDocument();
    expect(within(drawer).getByText('Alert Created')).toBeInTheDocument();
    expect(within(drawer).getByText('Alerts')).toBeInTheDocument();
    expect(within(drawer).getByText('System · core')).toBeInTheDocument();
    expect(within(drawer).getAllByText('task_instance / task-1')).toHaveLength(2);
    expect(within(drawer).getByText('Trace Truncated')).toBeInTheDocument();
    expect(within(drawer).getByText('Trace limited to 50 entries')).toBeInTheDocument();
    expect(within(drawer).getAllByText('Step').length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText('Event').length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText('Delivery').length).toBeGreaterThan(0);
    expect(within(drawer).getByText('Failed · Retry scheduled')).toBeInTheDocument();
    const succeededEntry = within(drawer).getByText('Delivery succeeded').closest('li');
    expect(succeededEntry).not.toBeNull();
    expect(within(succeededEntry as HTMLElement).getByText('Delivery')).toBeInTheDocument();
    expect(within(succeededEntry as HTMLElement).getByText('Succeeded')).toBeInTheDocument();
    expect(within(drawer).getByText('Recovered')).toBeInTheDocument();
    expect(drawer).toHaveTextContent('alert_type: missed_checkin');
  });

  it('renders an unavailable workflow identity when Core returns workflow null', async () => {
    mockClient.listAlerts.mockResolvedValue([baseAlert]);
    mockClient.getAlertTrace.mockResolvedValueOnce({ ...baseTrace, workflow: null });
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await user.click(screen.getByRole('button', { name: 'Trace' }));

    const drawer = await screen.findByRole('dialog', { name: 'Workflow trace for alert-1' });
    expect(
      within(drawer).getByText('Workflow identity is unavailable for this alert.')
    ).toBeInTheDocument();
  });

  it('renders empty trace as an empty state', async () => {
    mockClient.listAlerts.mockResolvedValue([baseAlert]);
    mockClient.getAlertTrace.mockResolvedValueOnce({
      alert_id: 'alert-1',
      partial: false,
      warnings: [],
      entries: [],
    });
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await user.click(screen.getByRole('button', { name: 'Trace' }));

    expect(
      await screen.findByText('No trace entries available for this alert.')
    ).toBeInTheDocument();
  });

  it('renders generic trace errors without leaking backend text', async () => {
    mockClient.listAlerts.mockResolvedValue([baseAlert]);
    mockClient.getAlertTrace.mockRejectedValueOnce(new Error('Bearer svc-token leaked'));
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await user.click(screen.getByRole('button', { name: 'Trace' }));

    expect(await screen.findByText('Trace request failed. Try again.')).toBeInTheDocument();
    expect(screen.queryByText(/svc-token/)).not.toBeInTheDocument();
  });

  it('refreshes trace for the same alert only when requested', async () => {
    const refreshedTrace = {
      ...baseTrace,
      entries: [{ ...baseTrace.entries[0], id: 'audit:audit-1', title: 'Operator acknowledged' }],
    };
    mockClient.listAlerts.mockResolvedValue([baseAlert]);
    mockClient.getAlertTrace.mockResolvedValueOnce(baseTrace).mockResolvedValueOnce(refreshedTrace);
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await user.click(screen.getByRole('button', { name: 'Trace' }));
    await screen.findByText('Alert created');

    await user.click(screen.getByRole('button', { name: 'Refresh trace' }));

    await screen.findByText('Operator acknowledged');
    expect(mockClient.getAlertTrace).toHaveBeenCalledTimes(2);
    expect(mockClient.getAlertTrace).toHaveBeenNthCalledWith(2, 'alert-1');
  });

  it('keeps the last loaded trace visible when refresh fails', async () => {
    mockClient.listAlerts.mockResolvedValue([baseAlert]);
    mockClient.getAlertTrace
      .mockResolvedValueOnce(baseTrace)
      .mockRejectedValueOnce(new Error('backend leaked svc-token'));
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await user.click(screen.getByRole('button', { name: 'Trace' }));
    await screen.findByText('Alert created');

    await user.click(screen.getByRole('button', { name: 'Refresh trace' }));

    expect(await screen.findByText('Trace request failed. Try again.')).toBeInTheDocument();
    expect(screen.getByText('Alert created')).toBeInTheDocument();
    expect(screen.queryByText(/svc-token/)).not.toBeInTheDocument();
    expect(mockClient.getAlertTrace).toHaveBeenCalledTimes(2);
  });

  it('traps trace drawer focus, restores focus, and closes on Escape or backdrop', async () => {
    mockClient.listAlerts.mockResolvedValue([baseAlert]);
    mockClient.getAlertTrace.mockResolvedValue(baseTrace);
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    const traceButton = screen.getByRole('button', { name: 'Trace' });
    await user.click(traceButton);

    const drawer = await screen.findByRole('dialog', { name: 'Workflow trace for alert-1' });
    expect(drawer).toHaveFocus();

    await user.tab({ shift: true });
    expect(within(drawer).getByRole('button', { name: 'Refresh trace' })).toHaveFocus();

    await user.tab();
    expect(within(drawer).getByRole('button', { name: 'Close' })).toHaveFocus();

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Workflow trace for alert-1' })
      ).not.toBeInTheDocument()
    );
    expect(traceButton).toHaveFocus();

    await user.click(traceButton);
    const reopenedDrawer = await screen.findByRole('dialog', {
      name: 'Workflow trace for alert-1',
    });
    fireEvent.mouseDown(reopenedDrawer.parentElement as HTMLElement);

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Workflow trace for alert-1' })
      ).not.toBeInTheDocument()
    );
  });

  it('keeps an open trace drawer through alert action refreshes without refetching trace', async () => {
    const acknowledged = {
      ...baseAlert,
      status: 'acknowledged',
      acknowledged_at: '2026-06-01T01:00:00Z',
    } as const;
    mockClient.listAlerts.mockResolvedValueOnce([baseAlert]).mockResolvedValueOnce([]);
    mockClient.getAlertTrace.mockResolvedValueOnce(baseTrace);
    mockClient.ackAlert.mockResolvedValueOnce(acknowledged);
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await user.click(screen.getByRole('button', { name: 'Trace' }));
    await screen.findByRole('dialog', { name: 'Workflow trace for alert-1' });
    await screen.findByText('Alert created');

    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));

    await waitFor(() => expect(mockClient.listAlerts).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('dialog', { name: 'Workflow trace for alert-1' })).toBeInTheDocument();
    expect(screen.getByText('Alert created')).toBeInTheDocument();
    expect(mockClient.getAlertTrace).toHaveBeenCalledTimes(1);
  });

  it('opens another row without rendering stale trace data from the first row', async () => {
    const secondAlert = {
      ...baseAlert,
      id: 'alert-2',
      related_id: 'task-2',
      summary: 'Milo missed a check-in.',
    } as const;
    const firstTrace = deferred<typeof baseTrace>();
    const secondTrace = {
      ...baseTrace,
      alert_id: 'alert-2',
      entries: [{ ...baseTrace.entries[0], id: 'alert:alert-2', title: 'Second alert trace' }],
    };
    mockClient.listAlerts.mockResolvedValue([baseAlert, secondAlert]);
    mockClient.getAlertTrace
      .mockReturnValueOnce(firstTrace.promise)
      .mockResolvedValueOnce(secondTrace);
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await screen.findByText('Milo missed a check-in.');

    await user.click(
      within(
        screen.getByText('Buddy missed a check-in.').closest('article') as HTMLElement
      ).getByRole('button', { name: 'Trace' })
    );
    await user.click(
      within(
        screen.getByText('Milo missed a check-in.').closest('article') as HTMLElement
      ).getByRole('button', { name: 'Trace' })
    );
    firstTrace.resolve({
      ...baseTrace,
      entries: [{ ...baseTrace.entries[0], id: 'alert:alert-1', title: 'First stale trace' }],
    });

    const drawer = await screen.findByRole('dialog', { name: 'Workflow trace for alert-2' });
    expect(await within(drawer).findByText('Second alert trace')).toBeInTheDocument();
    expect(within(drawer).queryByText('First stale trace')).not.toBeInTheDocument();
  });

  it('ignores trace responses that resolve after the drawer closes', async () => {
    const pendingTrace = deferred<typeof baseTrace>();
    mockClient.listAlerts.mockResolvedValue([baseAlert]);
    mockClient.getAlertTrace.mockReturnValueOnce(pendingTrace.promise);
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await user.click(screen.getByRole('button', { name: 'Trace' }));
    await screen.findByRole('dialog', { name: 'Workflow trace for alert-1' });
    await user.click(screen.getByRole('button', { name: 'Close' }));

    pendingTrace.resolve(baseTrace);

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Workflow trace for alert-1' })
      ).not.toBeInTheDocument()
    );
    expect(screen.queryByText('Alert created')).not.toBeInTheDocument();
  });

  it('renders bounded deterministic metadata chips for nested values', async () => {
    const longKey = `epsilon_${'very_long_metadata_key_'.repeat(4)}`;
    mockClient.listAlerts.mockResolvedValue([baseAlert]);
    mockClient.getAlertTrace.mockResolvedValueOnce({
      ...baseTrace,
      partial: false,
      warnings: [],
      entries: [
        {
          ...baseTrace.entries[0],
          metadata: {
            zeta: { b: 2, a: 1 },
            alpha: ['one', 'two'],
            beta: 'x'.repeat(120),
            [longKey]: 'visible',
            theta: null,
            yotta: Object.fromEntries(
              Array.from({ length: 40 }, (_, index) => [`key_${index}`, 'value'.repeat(40)])
            ),
            zz_overflow: 'hidden',
          },
        },
      ],
    });
    const user = userEvent.setup();

    render(<Workbench />);
    await screen.findByText('Buddy missed a check-in.');
    await user.click(screen.getByRole('button', { name: 'Trace' }));

    const metadata = await screen.findByLabelText('Metadata');
    expect(metadata).toHaveTextContent('alpha: ["one","two"]');
    expect(metadata).toHaveTextContent('zeta: {"a":1,"b":2}');
    expect(metadata).not.toHaveTextContent(longKey);
    expect(metadata).toHaveTextContent(`${longKey.slice(0, 47)}…`);
    expect(metadata.textContent).not.toContain('x'.repeat(100));
    expect(metadata.textContent).not.toContain('value'.repeat(20));
    expect(metadata).not.toHaveTextContent('zz_overflow');
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
