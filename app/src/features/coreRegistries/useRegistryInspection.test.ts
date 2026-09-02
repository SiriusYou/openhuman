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
import { CoreRpcError } from '../../services/coreRpcClient';
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

const toolDefinitionSummary: ToolRegistryToolDefinitionSummary = {
  toolKey: 'tool.alpha',
  version: 3,
  lifecycleState: 'active',
  definitionFingerprint: 'b'.repeat(64),
  schemaVersion: 1,
  displayName: 'Tool Alpha',
  description: 'Reads data',
  toolEffectClass: 'read_only',
  abstractAuthScopes: ['scope.read'],
  createdAt: '2026-09-01T12:05:00Z',
};

const toolEnablement: ToolRegistryToolEnablement = {
  toolKey: 'tool.alpha',
  version: 5,
  lifecycleState: 'enabled',
  generation: 12,
  timeoutCapMs: 5000,
  approvalRequired: false,
  allowTtlSeconds: null,
  auditMode: 'metadata_only',
  updatedAt: '2026-09-01T12:06:00Z',
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

  it('reopens a same-tab cached detail from history after re-establishing selection state', async () => {
    const client = makeClient();
    vi.mocked(client.listAgents).mockResolvedValue({ items: [agentSummary], nextCursor: null });
    vi.mocked(client.getAgentVersion).mockResolvedValue(agentDetail);

    const { result } = renderHook(() => useRegistryInspection({ client }));

    await waitFor(() =>
      expect(result.current.state.tabs.agents.collections.agents.items).toEqual([agentSummary])
    );

    await act(async () => {
      await result.current.openDetail({ kind: 'agent', key: 'agent.alpha', version: 7 });
    });

    expect(client.getAgentVersion).toHaveBeenCalledTimes(1);
    expect(result.current.state.tabs.agents.detail).toEqual({
      kind: 'loaded',
      detail: { kind: 'agent', key: 'agent.alpha', version: 7 },
      record: agentDetail,
    });

    await act(async () => {
      window.history.pushState({}, '', '/registries?tab=agents');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => expect(result.current.state.tabs.agents.detail).toEqual({ kind: 'none' }));

    await act(async () => {
      await result.current.openDetail({ kind: 'agent', key: 'agent.alpha', version: 7 });
    });

    await waitFor(() =>
      expect(result.current.state.tabs.agents.detail).toEqual({
        kind: 'loaded',
        detail: { kind: 'agent', key: 'agent.alpha', version: 7 },
        record: agentDetail,
      })
    );
    expect(client.getAgentVersion).toHaveBeenCalledTimes(1);
  });

  it('retries one collection without marking sibling collections loading for the new generation', async () => {
    const client = makeClient();
    const retriedDefinitions = deferred<CursorRegistryPage<ToolRegistryToolDefinitionSummary>>();
    vi.mocked(client.listAgents).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.listToolDefinitions)
      .mockResolvedValueOnce({ items: [toolDefinitionSummary], nextCursor: null })
      .mockReturnValueOnce(retriedDefinitions.promise);
    vi.mocked(client.listToolEnablements).mockResolvedValue({ items: [toolEnablement] });

    const { result } = renderHook(() => useRegistryInspection({ client }));

    await waitFor(() =>
      expect(result.current.state.tabs.agents.collections.agents.observation).toEqual({
        kind: 'empty',
        observedAt: '2026-09-01T12:00:00.000Z',
      })
    );

    await act(async () => {
      await result.current.setTab('tools');
    });

    await waitFor(() => expect(result.current.state.tabs.tools.summaryState).toBe('fresh'));
    const initialEnablementsObservation =
      result.current.state.tabs.tools.collections.toolEnablements.observation;

    act(() => {
      void result.current.retryCollection('toolDefinitions');
    });

    expect(result.current.state.tabs.tools.collections.toolDefinitions.observation).toEqual({
      kind: 'loading',
      generation: 2,
    });
    expect(result.current.state.tabs.tools.collections.toolEnablements.observation).toEqual(
      initialEnablementsObservation
    );

    retriedDefinitions.resolve({
      items: [{ ...toolDefinitionSummary, version: 4 }],
      nextCursor: null,
    });

    await waitFor(() =>
      expect(result.current.state.tabs.tools.collections.toolDefinitions.items).toEqual([
        { ...toolDefinitionSummary, version: 4 },
      ])
    );

    expect(result.current.state.tabs.tools.collections.toolEnablements.items).toEqual([
      toolEnablement,
    ]);
    expect(result.current.state.tabs.tools.summaryState).toBe('fresh');
    expect(client.listToolEnablements).toHaveBeenCalledTimes(1);
  });

  it('consumes invalid-cursor restart budget once per collection generation even after a successful restart', async () => {
    const client = makeClient();
    vi.mocked(client.listAgents)
      .mockResolvedValueOnce({ items: [agentSummary], nextCursor: 'stale-cursor' })
      .mockRejectedValueOnce(
        new CoreRpcError('invalid cursor', 'unknown', 422, {
          kind: 'YouPetCoreHttpError',
          youpet: { http_status: 422, code: 'invalid_cursor' },
        })
      )
      .mockResolvedValueOnce({
        items: [{ ...agentSummary, agentKey: 'agent.beta' }],
        nextCursor: 'stale-cursor',
      })
      .mockRejectedValueOnce(
        new CoreRpcError('invalid cursor', 'unknown', 422, {
          kind: 'YouPetCoreHttpError',
          youpet: { http_status: 422, code: 'invalid_cursor' },
        })
      )
      .mockResolvedValueOnce({
        items: [{ ...agentSummary, agentKey: 'agent.gamma' }],
        nextCursor: null,
      });

    const { result } = renderHook(() => useRegistryInspection({ client }));

    await waitFor(() =>
      expect(result.current.state.tabs.agents.collections.agents.items).toEqual([agentSummary])
    );

    await act(async () => {
      await result.current.loadMoreCollection('agents');
    });

    await waitFor(() =>
      expect(result.current.state.tabs.agents.collections.agents.items).toEqual([
        { ...agentSummary, agentKey: 'agent.beta' },
      ])
    );

    await act(async () => {
      await result.current.loadMoreCollection('agents');
    });

    await waitFor(() =>
      expect(result.current.state.tabs.agents.collections.agents.observation).toEqual({
        kind: 'blocked',
        error: { kind: 'YouPetCoreHttpError', httpStatus: 422, coreCode: 'invalid_cursor' },
      })
    );

    expect(client.listAgents).toHaveBeenCalledTimes(4);
    expect(result.current.state.tabs.agents.collections.agents.items).toEqual([]);
  });

  it('replaces the current detail URL with tab-only state when a surface blocker clears the active tab', async () => {
    const client = makeClient();
    const blockedError = new CoreRpcError('forbidden actor', 'unknown', 403, {
      kind: 'YouPetCoreHttpError',
      youpet: { http_status: 403, code: 'forbidden_actor' },
    });
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    vi.mocked(client.listAgents).mockResolvedValue({ items: [agentSummary], nextCursor: null });
    vi.mocked(client.listToolDefinitions).mockResolvedValue({
      items: [toolDefinitionSummary],
      nextCursor: null,
    });
    vi.mocked(client.listToolEnablements).mockResolvedValue({ items: [toolEnablement] });
    vi.mocked(client.getToolDefinitionVersion).mockRejectedValue(blockedError);

    const { result } = renderHook(() => useRegistryInspection({ client }));

    await waitFor(() =>
      expect(result.current.state.tabs.agents.collections.agents.items).toEqual([agentSummary])
    );

    await act(async () => {
      await result.current.setTab('tools');
    });

    await waitFor(() => expect(result.current.state.tabs.tools.summaryState).toBe('fresh'));

    await act(async () => {
      await result.current.openDetail({ kind: 'tool-definition', key: 'tool.alpha', version: 3 });
    });

    await waitFor(() =>
      expect(result.current.state.surfaceError).toEqual({
        kind: 'YouPetCoreHttpError',
        httpStatus: 403,
        coreCode: 'forbidden_actor',
      })
    );

    expect(result.current.state.urlState).toEqual({ tab: 'tools', detail: null });
    expect(window.location.search).toBe('?tab=tools');
    expect(replaceStateSpy).toHaveBeenCalledWith({}, '', '/registries?tab=tools');
  });

  it('does not resurrect cached detail from history after a surface blocker already cleared the selection', async () => {
    const client = makeClient();
    const blockedError = new CoreRpcError('forbidden actor', 'unknown', 403, {
      kind: 'YouPetCoreHttpError',
      youpet: { http_status: 403, code: 'forbidden_actor' },
    });

    vi.mocked(client.listAgents)
      .mockResolvedValueOnce({ items: [agentSummary], nextCursor: null })
      .mockRejectedValueOnce(blockedError);
    vi.mocked(client.listToolDefinitions)
      .mockResolvedValueOnce({
        items: [toolDefinitionSummary],
        nextCursor: null,
      })
      .mockRejectedValueOnce(blockedError);
    vi.mocked(client.listToolEnablements)
      .mockResolvedValueOnce({ items: [toolEnablement] })
      .mockResolvedValueOnce({ items: [toolEnablement] });
    vi.mocked(client.getToolDefinitionVersion).mockResolvedValue(toolDefinitionSummary);

    const { result } = renderHook(() => useRegistryInspection({ client }));

    await waitFor(() =>
      expect(result.current.state.tabs.agents.collections.agents.items).toEqual([agentSummary])
    );

    await act(async () => {
      await result.current.setTab('tools');
    });

    await waitFor(() => expect(result.current.state.tabs.tools.summaryState).toBe('fresh'));

    await act(async () => {
      await result.current.openDetail({ kind: 'tool-definition', key: 'tool.alpha', version: 3 });
    });

    await waitFor(() =>
      expect(result.current.state.tabs.tools.detail).toEqual({
        kind: 'loaded',
        detail: { kind: 'tool-definition', key: 'tool.alpha', version: 3 },
        record: toolDefinitionSummary,
      })
    );

    await act(async () => {
      await result.current.setTab('agents');
    });

    await act(async () => {
      await result.current.refreshActiveTab();
      window.history.pushState(
        {},
        '',
        '/registries?tab=tools&kind=tool-definition&key=tool.alpha&version=3'
      );
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(result.current.state.urlState).toEqual({ tab: 'tools', detail: null });
    expect(result.current.state.tabs.tools.detail).toEqual({ kind: 'none' });
    expect(window.location.search).toBe('?tab=tools');
    expect(client.getToolDefinitionVersion).toHaveBeenCalledTimes(1);
  });

  it('reloads a previously visited tab after a surface blocker resets all tab data', async () => {
    const client = makeClient();
    const blockedError = new CoreRpcError('forbidden actor', 'unknown', 403, {
      kind: 'YouPetCoreHttpError',
      youpet: { http_status: 403, code: 'forbidden_actor' },
    });

    vi.mocked(client.listAgents).mockResolvedValue({ items: [agentSummary], nextCursor: null });
    vi.mocked(client.listToolDefinitions)
      .mockResolvedValueOnce({ items: [toolDefinitionSummary], nextCursor: null })
      .mockRejectedValueOnce(blockedError)
      .mockResolvedValueOnce({
        items: [{ ...toolDefinitionSummary, version: 4 }],
        nextCursor: null,
      });
    vi.mocked(client.listToolEnablements)
      .mockResolvedValueOnce({ items: [toolEnablement] })
      .mockResolvedValueOnce({ items: [toolEnablement] })
      .mockResolvedValueOnce({
        items: [
          { ...toolEnablement, version: 6, generation: 13, updatedAt: '2026-09-01T12:07:00Z' },
        ],
      });

    const { result } = renderHook(() => useRegistryInspection({ client }));

    await waitFor(() =>
      expect(result.current.state.tabs.agents.collections.agents.items).toEqual([agentSummary])
    );

    await act(async () => {
      await result.current.setTab('tools');
    });

    await waitFor(() => expect(result.current.state.tabs.tools.summaryState).toBe('fresh'));

    await act(async () => {
      await result.current.refreshActiveTab();
    });

    await waitFor(() =>
      expect(result.current.state.surfaceError).toEqual({
        kind: 'YouPetCoreHttpError',
        httpStatus: 403,
        coreCode: 'forbidden_actor',
      })
    );

    expect(result.current.state.tabs.tools.collections.toolDefinitions.items).toEqual([]);
    expect(result.current.state.tabs.tools.collections.toolEnablements.items).toEqual([]);

    await act(async () => {
      await result.current.setTab('tools');
    });

    await waitFor(() =>
      expect(result.current.state.tabs.tools.collections.toolDefinitions.items).toEqual([
        { ...toolDefinitionSummary, version: 4 },
      ])
    );
    expect(result.current.state.tabs.tools.collections.toolEnablements.items).toEqual([
      { ...toolEnablement, version: 6, generation: 13, updatedAt: '2026-09-01T12:07:00Z' },
    ]);
    expect(client.listToolDefinitions).toHaveBeenCalledTimes(3);
    expect(client.listToolEnablements).toHaveBeenCalledTimes(3);
  });
});
