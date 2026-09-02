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
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('Missing enablement')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /load more definitions/i }));
    expect(loadMoreCollectionMock).toHaveBeenCalledWith('toolDefinitions');
  });

  it('shows a read-only Core integration blocker when registry inspection is surface blocked', () => {
    useRegistryInspectionMock.mockReturnValue({
      state: cloneState({
        surfaceError: { kind: 'YouPetConfigMissing' },
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

    expect(
      screen.getByText('Core integration is blocking registry inspection.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('This screen is read-only and cannot write configuration for you.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save|connect|apply/i })).not.toBeInTheDocument();
  });
});

describe('RegistryDetailPane', () => {
  it('shows exact cross-links, unresolved references, lifecycle explanations, and inert JSON', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

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
    expect(screen.getByText('Fingerprint · aaaaaaaaaaaa')).toBeInTheDocument();
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

    await user.tab();
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
