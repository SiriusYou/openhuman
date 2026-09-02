import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ReadOnlyJson from './ReadOnlyJson';
import RegistryDetailDrawer from './RegistryDetailDrawer';
import RegistryDetailPane from './RegistryDetailPane';
import type { RegistryInspectionState } from './types';

const openDetailMock = vi.hoisted(() => vi.fn());
const setTabMock = vi.hoisted(() => vi.fn());
const refreshActiveTabMock = vi.hoisted(() => vi.fn());
const loadMoreCollectionMock = vi.hoisted(() => vi.fn());
const retryCollectionMock = vi.hoisted(() => vi.fn());
const useRegistryInspectionMock = vi.hoisted(() => vi.fn());

vi.mock('./useRegistryInspection', () => ({
  useRegistryInspection: () => useRegistryInspectionMock(),
}));

const CoreRegistriesPage = (await import('./CoreRegistriesPage')).default;

let viewportWidth = 1440;

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    matches: query === '(min-width: 1280px)' ? viewportWidth >= 1280 : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const baseState: RegistryInspectionState = {
  urlState: { tab: 'agents', detail: null },
  surfaceError: null,
  tabs: {
    agents: {
      generation: 1,
      observedAt: '2026-09-02T04:05:00Z',
      summaryState: 'fresh',
      detail: { kind: 'none' },
      collections: {
        agents: {
          items: [
            {
              id: 'agent-row',
              agentKey: 'agent.alpha',
              version: 7,
              lifecycleState: 'active',
              configurationFingerprint: 'a'.repeat(64),
              ownerActorType: 'service',
              ownerActorId: 'registry-reader',
              createdAt: '2026-09-01T12:00:00Z',
            },
          ],
          nextCursor: null,
          observation: { kind: 'loaded', observedAt: '2026-09-02T04:05:00Z', stale: false },
          lastObservedAt: '2026-09-02T04:05:00Z',
          successGeneration: 1,
          restartGeneration: null,
        },
      },
    },
    tools: {
      generation: 1,
      observedAt: '2026-09-02T04:06:00Z',
      summaryState: 'partial',
      detail: { kind: 'none' },
      collections: {
        toolDefinitions: {
          items: [
            {
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
            },
            {
              toolKey: 'tool.beta',
              version: 2,
              lifecycleState: 'active',
              definitionFingerprint: 'c'.repeat(64),
              schemaVersion: 1,
              displayName: 'Tool Beta',
              description: 'Does not have an enablement yet',
              toolEffectClass: 'effectful',
              abstractAuthScopes: [],
              createdAt: '2026-09-01T12:08:00Z',
            },
          ],
          nextCursor: 'tool-definition-cursor-2',
          observation: {
            kind: 'stale',
            observedAt: '2026-09-02T04:06:00Z',
            error: { kind: 'YouPetCoreTransport' },
          },
          lastObservedAt: '2026-09-02T04:06:00Z',
          successGeneration: 1,
          restartGeneration: null,
        },
        toolEnablements: {
          items: [
            {
              toolKey: 'tool.alpha',
              version: 5,
              lifecycleState: 'disabled',
              generation: 12,
              timeoutCapMs: 5000,
              approvalRequired: false,
              allowTtlSeconds: null,
              auditMode: 'metadata_only',
              updatedAt: '2026-09-01T12:06:00Z',
            },
          ],
          observation: { kind: 'loaded', observedAt: '2026-09-02T04:06:00Z', stale: false },
          lastObservedAt: '2026-09-02T04:06:00Z',
          successGeneration: 1,
          restartGeneration: null,
        },
      },
    },
    connectors: {
      generation: 1,
      observedAt: '2026-09-02T04:07:00Z',
      summaryState: 'fresh',
      detail: { kind: 'none' },
      collections: {
        connectorTypes: {
          items: [
            {
              connectorKey: 'connector.wecom',
              version: 4,
              lifecycleState: 'active',
              sourceType: 'wecom',
              connectorTypeFingerprint: 'd'.repeat(64),
              capabilities: ['messages.read'],
              createdAt: '2026-09-01T12:20:00Z',
            },
          ],
          nextCursor: null,
          observation: { kind: 'loaded', observedAt: '2026-09-02T04:07:00Z', stale: false },
          lastObservedAt: '2026-09-02T04:07:00Z',
          successGeneration: 1,
          restartGeneration: null,
        },
        connectorBindings: {
          items: [
            {
              bindingKey: 'binding.ops-primary',
              version: 2,
              lifecycleState: 'active',
              connectorTypeKey: 'connector.wecom',
              connectorTypeVersion: 4,
              connectorTypeFingerprint: 'd'.repeat(64),
              enabledCapabilities: ['messages.read'],
              bindingFingerprint: 'e'.repeat(64),
              createdAt: '2026-09-01T12:21:00Z',
            },
          ],
          nextCursor: null,
          observation: { kind: 'loaded', observedAt: '2026-09-02T04:07:00Z', stale: false },
          lastObservedAt: '2026-09-02T04:07:00Z',
          successGeneration: 1,
          restartGeneration: null,
        },
      },
    },
  },
};

function cloneState(overrides?: Partial<RegistryInspectionState>): RegistryInspectionState {
  return {
    ...baseState,
    ...overrides,
    urlState: overrides?.urlState ?? baseState.urlState,
    tabs: overrides?.tabs ?? baseState.tabs,
  };
}

describe('CoreRegistriesPage', () => {
  it('renders registry tabs and does not auto-select a detail record', () => {
    useRegistryInspectionMock.mockReturnValue({
      state: cloneState(),
      setTab: setTabMock,
      refreshActiveTab: refreshActiveTabMock,
      loadMoreCollection: loadMoreCollectionMock,
      openDetail: openDetailMock,
      retryCollection: retryCollectionMock,
    });

    render(<CoreRegistriesPage />);

    expect(screen.getByRole('heading', { name: 'Core Registries' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Agents' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Connectors' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /agent\.alpha/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /registry detail/i })).not.toBeInTheDocument();
    expect(
      screen.getByText('Select a record to inspect its exact registry version.')
    ).toBeInTheDocument();
  });

  it('keeps Definitions and Enablements separate and distinguishes missing enablement from disabled', async () => {
    const user = userEvent.setup();
    useRegistryInspectionMock.mockReturnValue({
      state: cloneState({ urlState: { tab: 'tools', detail: null } }),
      setTab: setTabMock,
      refreshActiveTab: refreshActiveTabMock,
      loadMoreCollection: loadMoreCollectionMock,
      openDetail: openDetailMock,
      retryCollection: retryCollectionMock,
    });

    render(<CoreRegistriesPage />);

    expect(screen.getByRole('tab', { name: 'Tools' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Definitions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Enablements' })).toBeInTheDocument();
    expect(screen.getByText('Tools · Partial')).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getAllByText('Disabled')).toHaveLength(1);
    expect(screen.getAllByText('No Tenant Enablement returned')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /load more definitions/i }));
    expect(loadMoreCollectionMock).toHaveBeenCalledWith('toolDefinitions');
  });

  it('renders the actual detail pane on wide screens and keeps the drawer narrow-only', () => {
    viewportWidth = 1440;
    useRegistryInspectionMock.mockReturnValue({
      state: cloneState({
        urlState: { tab: 'agents', detail: { kind: 'agent', key: 'agent.alpha', version: 7 } },
        tabs: {
          ...baseState.tabs,
          agents: {
            ...baseState.tabs.agents,
            detail: {
              kind: 'loaded',
              detail: { kind: 'agent', key: 'agent.alpha', version: 7 },
              record: {
                id: 'agent-row',
                agentKey: 'agent.alpha',
                version: 7,
                lifecycleState: 'active',
                configurationFingerprint: 'a'.repeat(64),
                ownerActorType: 'service',
                ownerActorId: 'registry-reader',
                createdAt: '2026-09-01T12:00:00Z',
                configuration: {
                  schemaVersion: 1,
                  domainKey: 'ops',
                  owner: { actorType: 'service', actorId: 'registry-reader' },
                  allowedToolRefs: [],
                  knowledgeScopeRefs: [],
                  riskPolicyRef: null,
                },
              },
            },
          },
        },
      }),
      setTab: setTabMock,
      refreshActiveTab: refreshActiveTabMock,
      loadMoreCollection: loadMoreCollectionMock,
      openDetail: openDetailMock,
      retryCollection: retryCollectionMock,
    });

    render(<CoreRegistriesPage />);

    expect(screen.getByRole('heading', { name: 'agent.alpha v7' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /registry detail/i })).not.toBeInTheDocument();
  });

  it('renders the detail drawer only on narrow screens', () => {
    viewportWidth = 1024;
    useRegistryInspectionMock.mockReturnValue({
      state: cloneState({
        urlState: { tab: 'agents', detail: { kind: 'agent', key: 'agent.alpha', version: 7 } },
        tabs: {
          ...baseState.tabs,
          agents: {
            ...baseState.tabs.agents,
            detail: {
              kind: 'loaded',
              detail: { kind: 'agent', key: 'agent.alpha', version: 7 },
              record: {
                id: 'agent-row',
                agentKey: 'agent.alpha',
                version: 7,
                lifecycleState: 'active',
                configurationFingerprint: 'a'.repeat(64),
                ownerActorType: 'service',
                ownerActorId: 'registry-reader',
                createdAt: '2026-09-01T12:00:00Z',
                configuration: {
                  schemaVersion: 1,
                  domainKey: 'ops',
                  owner: { actorType: 'service', actorId: 'registry-reader' },
                  allowedToolRefs: [],
                  knowledgeScopeRefs: [],
                  riskPolicyRef: null,
                },
              },
            },
          },
        },
      }),
      setTab: setTabMock,
      refreshActiveTab: refreshActiveTabMock,
      loadMoreCollection: loadMoreCollectionMock,
      openDetail: openDetailMock,
      retryCollection: retryCollectionMock,
    });

    render(<CoreRegistriesPage />);

    expect(screen.getByRole('dialog', { name: 'agent.alpha v7' })).toBeInTheDocument();
  });

  it('links tabs to their tabpanel and supports arrow-key tab navigation with a polite live region', async () => {
    const user = userEvent.setup();
    useRegistryInspectionMock.mockReturnValue({
      state: cloneState(),
      setTab: setTabMock,
      refreshActiveTab: refreshActiveTabMock,
      loadMoreCollection: loadMoreCollectionMock,
      openDetail: openDetailMock,
      retryCollection: retryCollectionMock,
    });

    render(<CoreRegistriesPage />);

    const agentsTab = screen.getByRole('tab', { name: 'Agents' });
    const toolsTab = screen.getByRole('tab', { name: 'Tools' });
    const tabpanel = screen.getByRole('tabpanel');
    const live = screen.getByRole('status');

    expect(agentsTab).toHaveAttribute('aria-controls', tabpanel.id);
    expect(tabpanel).toHaveAttribute('aria-labelledby', agentsTab.id);
    expect(live).toHaveAttribute('aria-live', 'polite');

    agentsTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(setTabMock).toHaveBeenCalledWith('tools');
    expect(toolsTab).toHaveFocus();
  });

  it('supports keyboard row navigation inside a collection and preserves Enter activation', async () => {
    const user = userEvent.setup();
    useRegistryInspectionMock.mockReturnValue({
      state: cloneState({
        tabs: {
          ...baseState.tabs,
          agents: {
            ...baseState.tabs.agents,
            collections: {
              agents: {
                ...baseState.tabs.agents.collections.agents,
                items: [
                  baseState.tabs.agents.collections.agents.items[0],
                  {
                    ...baseState.tabs.agents.collections.agents.items[0],
                    id: 'agent-row-2',
                    agentKey: 'agent.beta',
                    version: 8,
                  },
                ],
              },
            },
          },
        },
      }),
      setTab: setTabMock,
      refreshActiveTab: refreshActiveTabMock,
      loadMoreCollection: loadMoreCollectionMock,
      openDetail: openDetailMock,
      retryCollection: retryCollectionMock,
    });

    render(<CoreRegistriesPage />);

    const rows = screen.getAllByRole('button', { name: /agent\.(alpha|beta)/i });
    rows[0]?.focus();

    await user.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();

    await user.keyboard('{Home}');
    expect(rows[0]).toHaveFocus();

    await user.keyboard('{End}');
    expect(rows[1]).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(openDetailMock).toHaveBeenCalledWith({ kind: 'agent', key: 'agent.beta', version: 8 });
  });

  it.each([
    [
      { kind: 'YouPetConfigMissing' as const },
      'Core integration required',
      'No Core integration configuration was found for registry inspection.',
    ],
    [
      { kind: 'YouPetConfigInvalid' as const },
      'Core integration invalid',
      'The current Core integration configuration is invalid for registry inspection.',
    ],
    [
      { kind: 'YouPetCoreHttpError' as const, httpStatus: 401, coreCode: 'unauthorized' },
      'Core authentication required',
      'Registry inspection could not authenticate with Core for this session.',
    ],
    [
      { kind: 'YouPetCoreHttpError' as const, httpStatus: 403, coreCode: 'forbidden_actor' },
      'Registry inspection forbidden',
      'Core rejected this actor for tenant registry inspection.',
    ],
    [
      {
        kind: 'YouPetCoreHttpError' as const,
        httpStatus: 503,
        coreCode: 'kernel_tenant_unavailable',
      },
      'Tenant unavailable',
      'Core reported that this tenant is temporarily unavailable for registry inspection.',
    ],
    [
      {
        kind: 'YouPetCoreHttpError' as const,
        httpStatus: 503,
        coreCode: 'kernel_tenant_invariant_violation',
      },
      'Tenant invariant violation',
      'Core reported a tenant invariant violation for registry inspection.',
    ],
  ])('shows distinct read-only blocker copy for %j', (surfaceError, heading, description) => {
    useRegistryInspectionMock.mockReturnValue({
      state: cloneState({
        surfaceError,
        tabs: {
          ...baseState.tabs,
          agents: { ...baseState.tabs.agents, summaryState: 'blocked' },
          tools: { ...baseState.tabs.tools, summaryState: 'blocked' },
          connectors: { ...baseState.tabs.connectors, summaryState: 'blocked' },
        },
      }),
      setTab: setTabMock,
      refreshActiveTab: refreshActiveTabMock,
      loadMoreCollection: loadMoreCollectionMock,
      openDetail: openDetailMock,
      retryCollection: retryCollectionMock,
    });

    render(<CoreRegistriesPage />);

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
    expect(
      screen.getByText('This screen is read-only and cannot write configuration for you.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save|connect|apply/i })).not.toBeInTheDocument();
  });
});

describe('RegistryDetailPane', () => {
  it('shows exact cross-links, family fingerprint labels, lifecycle explanations, and inert JSON', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    render(
      <RegistryDetailPane
        activeTab="agents"
        detailState={{
          kind: 'loaded',
          detail: { kind: 'agent', key: 'agent.alpha', version: 7 },
          record: {
            id: 'agent-row',
            agentKey: 'agent.alpha',
            version: 7,
            lifecycleState: 'draft',
            configurationFingerprint: 'a'.repeat(64),
            ownerActorType: 'service',
            ownerActorId: 'registry-reader',
            createdAt: '2026-09-01T12:00:00Z',
            configuration: {
              schemaVersion: 1,
              domainKey: 'ops',
              owner: { actorType: 'service', actorId: 'registry-reader' },
              allowedToolRefs: [
                { toolKey: 'tool.alpha', version: 3 },
                { toolKey: 'tool.missing', version: 9 },
              ],
              knowledgeScopeRefs: [
                { sourceKey: 'kb.ops', trustVersion: '2026-09', accessScope: 'read' },
              ],
              riskPolicyRef: { policyId: 'policy.ops', policyVersion: 'v3' },
            },
          },
        }}
        state={cloneState({
          urlState: { tab: 'agents', detail: { kind: 'agent', key: 'agent.alpha', version: 7 } },
        })}
        onOpenDetail={openDetailMock}
      />
    );

    expect(screen.getByText('Agent lifecycle')).toBeInTheDocument();
    expect(
      screen.getByText('Active records are publish states, not runtime permission grants.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tool\.alpha v3/i })).toBeInTheDocument();
    expect(screen.getByText('Unresolved: tool.missing v9')).toBeInTheDocument();
    expect(
      screen.getByText('Logical references need follow-up outside this read-only view.')
    ).toBeInTheDocument();
    expect(screen.getByText(/"domainKey": "ops"/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /copy full fingerprint/i }));
    expect(writeText).toHaveBeenCalledWith('a'.repeat(64));
    expect(screen.getByText('Configuration fingerprint · aaaaaaaaaaaa')).toBeInTheDocument();
  });

  it('keeps tool definition enablement matching exact by {toolKey, version} and summarizes schemas before exposing raw JSON', () => {
    render(
      <RegistryDetailPane
        activeTab="tools"
        detailState={{
          kind: 'loaded',
          detail: { kind: 'tool-definition', key: 'tool.alpha', version: 3 },
          record: {
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
            inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
            outputSchema: { type: 'object', properties: { rows: { type: 'array' } } },
            timeoutDefaults: { timeoutMs: 5000 },
            retryContract: { maxAttempts: 2 },
            auditContract: { mode: 'metadata_only' },
          },
        }}
        state={cloneState({ urlState: { tab: 'tools', detail: null } })}
        onOpenDetail={openDetailMock}
      />
    );

    expect(screen.getByText('No Tenant Enablement returned')).toBeInTheDocument();
    expect(screen.getByText('Input schema')).toBeInTheDocument();
    expect(screen.getByText('Output schema')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View raw JSON' })).toBeInTheDocument();
    expect(screen.getByText('Definition fingerprint · bbbbbbbbbbbb')).toBeInTheDocument();
  });

  it('shows connector contract summaries and logical reference warnings without exposing secrets', () => {
    render(
      <RegistryDetailPane
        activeTab="connectors"
        detailState={{
          kind: 'loaded',
          detail: { kind: 'connector-binding', key: 'binding.ops-primary', version: 2 },
          record: {
            bindingKey: 'binding.ops-primary',
            version: 2,
            lifecycleState: 'active',
            connectorTypeKey: 'connector.wecom',
            connectorTypeVersion: 4,
            connectorTypeFingerprint: 'd'.repeat(64),
            enabledCapabilities: ['messages.read'],
            bindingFingerprint: 'e'.repeat(64),
            createdAt: '2026-09-01T12:21:00Z',
            providerAccount: { namespace: 'wechat', externalAccountRef: 'acct-primary' },
            configRef: 'cfg://binding/ops-primary',
            credentialRef: 'cred://binding/ops-primary',
          },
        }}
        state={cloneState({ urlState: { tab: 'connectors', detail: null } })}
        onOpenDetail={openDetailMock}
      />
    );

    expect(screen.getByText('Binding fingerprint · eeeeeeeeeeee')).toBeInTheDocument();
    expect(screen.getByText('wechat:acct-primary')).toBeInTheDocument();
    expect(screen.getByText('Logical reference only—secret not displayed')).toBeInTheDocument();
  });
});

describe('RegistryDetailDrawer', () => {
  it('traps focus, closes on Escape, and restores focus to the launching control', async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();

    render(
      <div>
        <button type="button">Launcher</button>
        <RegistryDetailDrawer
          title="Registry detail"
          onClose={handleClose}
          children={<button type="button">Focusable detail action</button>}
        />
      </div>
    );

    const launcher = screen.getByRole('button', { name: 'Launcher' });
    launcher.focus();

    const dialog = screen.getByRole('dialog', { name: 'Registry detail' });
    expect(dialog).toBeInTheDocument();

    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();

    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Focusable detail action' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});

describe('ReadOnlyJson', () => {
  it('renders structured JSON in an inert viewer', () => {
    render(<ReadOnlyJson value={{ schemaVersion: 1, nested: { toolKey: 'tool.alpha' } }} />);

    expect(screen.getByText(/"schemaVersion": 1/)).toBeInTheDocument();
    expect(screen.getByText(/"toolKey": "tool.alpha"/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
