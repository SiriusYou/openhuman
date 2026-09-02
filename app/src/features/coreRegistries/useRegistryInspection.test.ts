import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentRegistryAgent,
  AgentRegistryAgentSummary,
  ConnectorRegistryBinding,
  ConnectorRegistryBindingSummary,
  ConnectorRegistryType,
  ConnectorRegistryTypeSummary,
  CursorRegistryPage,
  RegistryCursorListParams,
  ToolRegistryToolDefinition,
  ToolRegistryToolDefinitionSummary,
  ToolRegistryToolEnablement,
  UnpagedRegistryCollection,
} from '../../services/api/coreRegistriesClient';
import { LOAD_MORE_LIMIT } from './state';
import { type RegistryInspectionClient, useRegistryInspection } from './useRegistryInspection';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const agentSummary: AgentRegistryAgentSummary = {
  id: 'agent-row',
  agentKey: 'agent.alpha',
  version: 7,
  lifecycleState: 'active',
  configurationFingerprint: 'a'.repeat(64),
  ownerActorType: 'service',
  ownerActorId: 'registry-reader',
  createdAt: '2026-09-01T12:00:00Z',
};

const agentDetail: AgentRegistryAgent = {
  ...agentSummary,
  configuration: {
    schemaVersion: 1,
    domainKey: 'ops',
    owner: { actorType: 'service', actorId: 'registry-reader' },
    allowedToolRefs: [{ toolKey: 'tool.alpha', version: 3 }],
    knowledgeScopeRefs: [],
    riskPolicyRef: null,
  },
};

function makeClient(): RegistryInspectionClient {
  return {
    listAgents:
      vi.fn<
        (
          _: RegistryCursorListParams | undefined
        ) => Promise<CursorRegistryPage<AgentRegistryAgentSummary>>
      >(),
    getAgentVersion:
      vi.fn<(_: { agentKey: string; version: number }) => Promise<AgentRegistryAgent>>(),
    listToolDefinitions:
      vi.fn<
        (
          _: RegistryCursorListParams | undefined
        ) => Promise<CursorRegistryPage<ToolRegistryToolDefinitionSummary>>
      >(),
    getToolDefinitionVersion:
      vi.fn<(_: { toolKey: string; version: number }) => Promise<ToolRegistryToolDefinition>>(),
    listToolEnablements:
      vi.fn<() => Promise<UnpagedRegistryCollection<ToolRegistryToolEnablement>>>(),
    getToolEnablementVersion:
      vi.fn<(_: { toolKey: string; version: number }) => Promise<ToolRegistryToolEnablement>>(),
    listConnectorTypes:
      vi.fn<
        (
          _: RegistryCursorListParams | undefined
        ) => Promise<CursorRegistryPage<ConnectorRegistryTypeSummary>>
      >(),
    getConnectorTypeVersion:
      vi.fn<(_: { connectorKey: string; version: number }) => Promise<ConnectorRegistryType>>(),
    listConnectorBindings:
      vi.fn<
        (
          _: RegistryCursorListParams | undefined
        ) => Promise<CursorRegistryPage<ConnectorRegistryBindingSummary>>
      >(),
    getConnectorBindingVersion:
      vi.fn<(_: { bindingKey: string; version: number }) => Promise<ConnectorRegistryBinding>>(),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-01T12:00:00Z'));
  window.history.replaceState({}, '', '/registries');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRegistryInspection', () => {
  it('lazy-loads the default Agents tab without touching other tabs', async () => {
    const client = makeClient();
    vi.mocked(client.listAgents).mockResolvedValue({
      items: [agentSummary],
      nextCursor: 'agent-cursor-1',
    });

    const { result } = renderHook(() => useRegistryInspection({ client }));

    await waitFor(() =>
      expect(result.current.state.tabs.agents.collections.agents.items).toEqual([agentSummary])
    );

    expect(client.listAgents).toHaveBeenCalledWith({ limit: LOAD_MORE_LIMIT });
    expect(client.listToolDefinitions).not.toHaveBeenCalled();
    expect(client.listToolEnablements).not.toHaveBeenCalled();
    expect(client.listConnectorTypes).not.toHaveBeenCalled();
    expect(client.listConnectorBindings).not.toHaveBeenCalled();
    expect(result.current.state.urlState).toEqual({ tab: 'agents', detail: null });
  });

  it('loads more with limit 50 and restores exact history identity from the page-session detail cache', async () => {
    const client = makeClient();
    vi.mocked(client.listAgents)
      .mockResolvedValueOnce({ items: [agentSummary], nextCursor: 'agent-cursor-1' })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    vi.mocked(client.listToolDefinitions).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.listToolEnablements).mockResolvedValue({ items: [] });
    vi.mocked(client.getAgentVersion).mockResolvedValue(agentDetail);

    const { result } = renderHook(() => useRegistryInspection({ client }));

    await waitFor(() =>
      expect(result.current.state.tabs.agents.collections.agents.items).toEqual([agentSummary])
    );

    await act(async () => {
      await result.current.loadMoreCollection('agents');
    });

    expect(client.listAgents).toHaveBeenNthCalledWith(2, {
      limit: LOAD_MORE_LIMIT,
      cursor: 'agent-cursor-1',
    });

    await act(async () => {
      await result.current.openDetail({ kind: 'agent', key: 'agent.alpha', version: 7 });
    });

    expect(window.location.search).toBe('?tab=agents&kind=agent&key=agent.alpha&version=7');
    expect(client.getAgentVersion).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.setTab('tools');
    });

    expect(window.location.search).toBe('?tab=tools');
    expect(result.current.state.tabs.agents.collections.agents.items).toEqual([agentSummary]);
    expect(result.current.state.tabs.agents.detail).toEqual({ kind: 'none' });

    await act(async () => {
      window.history.back();
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() =>
      expect(result.current.state.urlState).toEqual({
        tab: 'agents',
        detail: { kind: 'agent', key: 'agent.alpha', version: 7 },
      })
    );
    expect(result.current.state.tabs.agents.detail).toEqual({
      kind: 'loaded',
      detail: { kind: 'agent', key: 'agent.alpha', version: 7 },
      record: agentDetail,
    });
    expect(client.getAgentVersion).toHaveBeenCalledTimes(1);
  });

  it('rejects late list responses after a newer refresh generation starts', async () => {
    const client = makeClient();
    const first = deferred<CursorRegistryPage<AgentRegistryAgentSummary>>();
    const second = deferred<CursorRegistryPage<AgentRegistryAgentSummary>>();
    vi.mocked(client.listAgents)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useRegistryInspection({ client }));

    act(() => {
      void result.current.refreshActiveTab();
    });

    expect(result.current.state.tabs.agents.generation).toBe(2);

    second.resolve({ items: [{ ...agentSummary, agentKey: 'agent.beta' }], nextCursor: null });
    await waitFor(() =>
      expect(result.current.state.tabs.agents.collections.agents.items).toEqual([
        { ...agentSummary, agentKey: 'agent.beta' },
      ])
    );

    first.resolve({ items: [agentSummary], nextCursor: null });
    await act(async () => {
      await first.promise;
    });

    expect(result.current.state.tabs.agents.collections.agents.items).toEqual([
      { ...agentSummary, agentKey: 'agent.beta' },
    ]);
  });
});
