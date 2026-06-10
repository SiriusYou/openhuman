import { describe, expect, it } from 'vitest';
import {
  CoreWorkbenchClientError,
  createCoreWorkbenchClient,
  type CoreWorkbenchFetch,
} from './coreWorkbenchClient';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });

function createFetch(handler: (request: CapturedRequest) => Response): {
  fetchFn: CoreWorkbenchFetch;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const fetchFn: CoreWorkbenchFetch = async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const request: CapturedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body:
        typeof init?.body === 'string' && init.body.length > 0
          ? JSON.parse(init.body)
          : undefined,
    };
    requests.push(request);
    return handler(request);
  };
  return { fetchFn, requests };
}

describe('coreWorkbenchClient', () => {
  it('lists Core alerts with service auth and filters', async () => {
    const { fetchFn, requests } = createFetch((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe('/api/v1/workbench/alerts');
      expect(url.searchParams.get('status')).toBe('open');
      expect(url.searchParams.get('severity')).toBe('critical');
      return jsonResponse({
        items: [
          {
            id: 'alert-1',
            alert_type: 'missed_checkin',
            severity: 'critical',
            related_type: 'task_instance',
            related_id: 'task-1',
            status: 'open',
            summary: 'Owner missed check-in.',
            created_at: '2026-06-01T00:00:00Z',
          },
        ],
      });
    });
    const client = createCoreWorkbenchClient({
      baseUrl: 'https://core.example.com/',
      serviceToken: 'svc-token',
      fetchFn,
    });

    const alerts = await client.listAlerts({ status: 'open', severity: 'critical' });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.id).toBe('alert-1');
    expect(requests[0]?.headers.authorization).toBe('Bearer svc-token');
    expect(requests[0]?.headers['x-actor-id']).toBe('openhuman-workbench');
  });

  it('sends an empty status query when callers request all alert states', async () => {
    const { fetchFn, requests } = createFetch(() => jsonResponse({ items: [] }));
    const client = createCoreWorkbenchClient({
      baseUrl: 'https://core.example.com',
      serviceToken: 'svc-token',
      fetchFn,
    });

    await client.listAlerts({ status: null });

    expect(new URL(requests[0]?.url ?? '').searchParams.get('status')).toBe('');
  });

  it('acknowledges alerts through Core instead of direct table writes', async () => {
    const { fetchFn, requests } = createFetch((request) => {
      expect(new URL(request.url).pathname).toBe('/api/v1/alerts/alert-1/ack');
      return jsonResponse({
        id: 'alert-1',
        alert_type: 'missed_checkin',
        severity: 'high',
        related_type: 'task_instance',
        related_id: 'task-1',
        status: 'acknowledged',
        created_at: '2026-06-01T00:00:00Z',
      });
    });
    const client = createCoreWorkbenchClient({
      baseUrl: 'https://core.example.com',
      serviceToken: 'svc-token',
      actorId: 'operator-workbench',
      fetchFn,
    });

    const alert = await client.ackAlert('alert-1', {
      actorUserId: 'user-1',
      note: 'Calling owner.',
      idempotencyKey: 'idem-ack-1',
    });

    expect(alert.status).toBe('acknowledged');
    expect(requests[0]).toMatchObject({
      method: 'POST',
      body: {
        actor_user_id: 'user-1',
        note: 'Calling owner.',
      },
    });
    expect(requests[0]?.headers['idempotency-key']).toBe('idem-ack-1');
    expect(requests[0]?.headers['x-actor-id']).toBe('operator-workbench');
  });

  it('resolves alerts through Core with resolution text', async () => {
    const { fetchFn, requests } = createFetch(() =>
      jsonResponse({
        id: 'alert-1',
        alert_type: 'missed_checkin',
        severity: 'medium',
        related_type: 'task_instance',
        related_id: 'task-1',
        status: 'resolved',
        created_at: '2026-06-01T00:00:00Z',
      })
    );
    const client = createCoreWorkbenchClient({
      baseUrl: 'https://core.example.com',
      serviceToken: 'svc-token',
      fetchFn,
    });

    await client.resolveAlert('alert-1', {
      actorUserId: 'user-1',
      resolution: 'Owner confirmed completion.',
    });

    expect(new URL(requests[0]?.url ?? '').pathname).toBe('/api/v1/alerts/alert-1/resolve');
    expect(requests[0]?.body).toEqual({
      actor_user_id: 'user-1',
      resolution: 'Owner confirmed completion.',
    });
  });

  it('wraps Core error responses with status and contract code', async () => {
    const { fetchFn } = createFetch(() =>
      jsonResponse({ detail: { code: 'not_found', message: 'alert not found' } }, 404)
    );
    const client = createCoreWorkbenchClient({
      baseUrl: 'https://core.example.com',
      serviceToken: 'svc-token',
      fetchFn,
    });

    await expect(client.ackAlert('missing', { actorUserId: 'user-1' })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'alert not found',
    } satisfies Partial<CoreWorkbenchClientError>);
  });
});
