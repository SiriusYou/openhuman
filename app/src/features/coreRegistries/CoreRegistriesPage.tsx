import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

import type { RegistryBridgeErrorMeta } from '../../services/api/coreRegistriesClient';
import RegistryCollectionPane, { type RegistryCollectionPaneItem } from './RegistryCollectionPane';
import RegistryDetailDrawer from './RegistryDetailDrawer';
import RegistryDetailPane from './RegistryDetailPane';
import { REGISTRY_TABS, type RegistryTab } from './types';
import { useRegistryInspection } from './useRegistryInspection';

function formatLiteral(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function shortFingerprint(value: string): string {
  return value.slice(0, 12);
}

function fingerprintLabel(family: string, value: string): string {
  return `${family} fp:${shortFingerprint(value)}`;
}

function tabSummary(tab: RegistryTab, summaryState: string) {
  const label = formatLiteral(summaryState);
  if (summaryState === 'fresh') {
    return `${formatLiteral(tab)} · Observed`;
  }
  return `${formatLiteral(tab)} · ${label}`;
}

function describeBlocker(error: RegistryBridgeErrorMeta) {
  if (error.kind === 'YouPetConfigMissing' || error.kind === 'YouPetConfigInvalid') {
    return error.kind === 'YouPetConfigMissing'
      ? {
          title: 'Core integration required',
          description: 'No Core integration configuration was found for registry inspection.',
        }
      : {
          title: 'Core integration invalid',
          description:
            'The current Core integration configuration is invalid for registry inspection.',
        };
  }

  if (error.kind === 'YouPetCoreHttpError' && error.httpStatus === 401) {
    return {
      title: 'Core authentication required',
      description: 'Registry inspection could not authenticate with Core for this session.',
    };
  }

  if (
    error.kind === 'YouPetCoreHttpError' &&
    error.httpStatus === 403 &&
    error.coreCode === 'forbidden_actor'
  ) {
    return {
      title: 'Registry inspection forbidden',
      description: 'Core rejected this actor for tenant registry inspection.',
    };
  }

  if (
    error.kind === 'YouPetCoreHttpError' &&
    error.httpStatus === 503 &&
    error.coreCode === 'kernel_tenant_unavailable'
  ) {
    return {
      title: 'Tenant unavailable',
      description:
        'Core reported that this tenant is temporarily unavailable for registry inspection.',
    };
  }

  if (
    error.kind === 'YouPetCoreHttpError' &&
    error.httpStatus === 503 &&
    error.coreCode === 'kernel_tenant_invariant_violation'
  ) {
    return {
      title: 'Tenant invariant violation',
      description: 'Core reported a tenant invariant violation for registry inspection.',
    };
  }

  return {
    title: 'Core integration required',
    description: 'Core integration is currently blocking registry inspection.',
  };
}

function hasMore(nextCursor: string | null) {
  return typeof nextCursor === 'string' && nextCursor.length > 0;
}

function useMinWidth(query: string): boolean {
  const getMatches = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia(query);
    const update = (event?: MediaQueryListEvent) =>
      setMatches(event?.matches ?? mediaQuery.matches);

    update();
    mediaQuery.addEventListener?.('change', update);
    mediaQuery.addListener?.(update);
    return () => {
      mediaQuery.removeEventListener?.('change', update);
      mediaQuery.removeListener?.(update);
    };
  }, [query]);

  return matches;
}

function tabId(tab: RegistryTab): string {
  return `registry-tab-${tab}`;
}

function tabPanelId(tab: RegistryTab): string {
  return `registry-panel-${tab}`;
}

export default function CoreRegistriesPage() {
  const { state, setTab, refreshActiveTab, loadMoreCollection, openDetail, retryCollection } =
    useRegistryInspection();
  const activeTab = state.urlState.tab;
  const detailState = state.tabs[activeTab].detail;
  const isWideLayout = useMinWidth('(min-width: 1280px)');
  const tabRefs = useRef<Record<RegistryTab, HTMLButtonElement | null>>({
    agents: null,
    tools: null,
    connectors: null,
  });
  const blocker = state.surfaceError ? describeBlocker(state.surfaceError) : null;

  const agentItems = useMemo<RegistryCollectionPaneItem[]>(
    () =>
      state.tabs.agents.collections.agents.items.map(agent => ({
        id: agent.id,
        title: agent.agentKey,
        subtitle: `v${agent.version} · ${formatLiteral(agent.ownerActorType)} · ${agent.ownerActorId}`,
        meta: [`Created ${new Date(agent.createdAt).toLocaleDateString()}`],
        statusLabel: formatLiteral(agent.lifecycleState),
        fingerprintLabel: fingerprintLabel('Config', agent.configurationFingerprint),
        onSelect: () =>
          void openDetail({ kind: 'agent', key: agent.agentKey, version: agent.version }),
      })),
    [openDetail, state.tabs.agents.collections.agents.items]
  );

  const toolItems = useMemo<RegistryCollectionPaneItem[]>(
    () =>
      state.tabs.tools.collections.toolDefinitions.items.map(definition => {
        const enablement = state.tabs.tools.collections.toolEnablements.items.find(
          item => item.toolKey === definition.toolKey && item.version === definition.version
        );
        const statusLabel = enablement
          ? enablement.lifecycleState === 'enabled'
            ? 'Enabled'
            : 'Disabled'
          : 'No Tenant Enablement returned';

        return {
          id: `${definition.toolKey}:${definition.version}`,
          title: definition.displayName,
          subtitle: `${definition.toolKey} v${definition.version}`,
          meta: [formatLiteral(definition.toolEffectClass)],
          statusLabel,
          fingerprintLabel: fingerprintLabel('Definition', definition.definitionFingerprint),
          onSelect: () =>
            void openDetail({
              kind: 'tool-definition',
              key: definition.toolKey,
              version: definition.version,
            }),
        };
      }),
    [
      openDetail,
      state.tabs.tools.collections.toolDefinitions.items,
      state.tabs.tools.collections.toolEnablements.items,
    ]
  );

  const enablementItems = useMemo<RegistryCollectionPaneItem[]>(
    () =>
      state.tabs.tools.collections.toolEnablements.items.map(enablement => ({
        id: `${enablement.toolKey}:${enablement.version}`,
        title: enablement.toolKey,
        subtitle: `v${enablement.version} · generation ${enablement.generation}`,
        meta: [
          enablement.auditMode ? formatLiteral(enablement.auditMode) : 'No audit mode',
          enablement.approvalRequired ? 'Approval required' : 'No approval gate',
        ],
        statusLabel: formatLiteral(enablement.lifecycleState),
        onSelect: () =>
          void openDetail({
            kind: 'tool-enablement',
            key: enablement.toolKey,
            version: enablement.version,
          }),
      })),
    [openDetail, state.tabs.tools.collections.toolEnablements.items]
  );

  const connectorTypeItems = useMemo<RegistryCollectionPaneItem[]>(
    () =>
      state.tabs.connectors.collections.connectorTypes.items.map(connectorType => ({
        id: `${connectorType.connectorKey}:${connectorType.version}`,
        title: connectorType.connectorKey,
        subtitle: `v${connectorType.version} · ${connectorType.sourceType}`,
        meta: connectorType.capabilities,
        statusLabel: formatLiteral(connectorType.lifecycleState),
        fingerprintLabel: fingerprintLabel('Type', connectorType.connectorTypeFingerprint),
        onSelect: () =>
          void openDetail({
            kind: 'connector-type',
            key: connectorType.connectorKey,
            version: connectorType.version,
          }),
      })),
    [openDetail, state.tabs.connectors.collections.connectorTypes.items]
  );

  const connectorBindingItems = useMemo<RegistryCollectionPaneItem[]>(
    () =>
      state.tabs.connectors.collections.connectorBindings.items.map(binding => ({
        id: `${binding.bindingKey}:${binding.version}`,
        title: binding.bindingKey,
        subtitle: `${binding.connectorTypeKey} v${binding.connectorTypeVersion}`,
        meta: binding.enabledCapabilities,
        statusLabel: formatLiteral(binding.lifecycleState),
        fingerprintLabel: fingerprintLabel('Binding', binding.bindingFingerprint),
        onSelect: () =>
          void openDetail({
            kind: 'connector-binding',
            key: binding.bindingKey,
            version: binding.version,
          }),
      })),
    [openDetail, state.tabs.connectors.collections.connectorBindings.items]
  );

  const selectedDetailTitle =
    detailState.kind === 'loaded' || detailState.kind === 'loading'
      ? `${detailState.detail.key} v${detailState.detail.version}`
      : 'Registry detail';

  const closeDetail = () => {
    void setTab(activeTab);
  };

  const liveMessage = blocker
    ? `${blocker.title}. ${blocker.description}`
    : detailState.kind === 'loaded'
      ? `${formatLiteral(activeTab)} tab active. Selected ${detailState.detail.key} version ${detailState.detail.version}.`
      : detailState.kind === 'loading'
        ? `${formatLiteral(activeTab)} tab active. Loading ${detailState.detail.key} version ${detailState.detail.version}.`
        : `${formatLiteral(activeTab)} tab active. No detail selected.`;

  const handleTabKeyDown = async (event: KeyboardEvent<HTMLButtonElement>, tab: RegistryTab) => {
    const currentIndex = REGISTRY_TABS.indexOf(tab);
    if (currentIndex === -1) {
      return;
    }

    let nextIndex: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (currentIndex + 1) % REGISTRY_TABS.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (currentIndex - 1 + REGISTRY_TABS.length) % REGISTRY_TABS.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = REGISTRY_TABS.length - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        await setTab(tab);
        return;
      default:
        return;
    }

    event.preventDefault();
    const nextTab = REGISTRY_TABS[nextIndex];
    if (!nextTab) {
      return;
    }
    tabRefs.current[nextTab]?.focus();
    await setTab(nextTab);
  };

  return (
    <div className="min-h-full bg-stone-50 px-4 py-8 dark:bg-neutral-950">
      <div className="mx-auto max-w-7xl space-y-6">
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {liveMessage}
        </div>

        <header className="rounded-[28px] border border-stone-200 bg-white px-6 py-6 shadow-soft dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-stone-500 dark:text-neutral-400">
                Registry Views
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-stone-900 dark:text-neutral-100">
                Core Registries
              </h1>
              <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-neutral-300">
                Read-only inspection for exact agent, tool, and connector records backed by Core.
                This screen never writes configuration, secrets, or runtime state.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                void refreshActiveTab();
              }}
              className="inline-flex items-center rounded-2xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
              Refresh
            </button>
          </div>
        </header>

        {state.surfaceError ? (
          <section className="rounded-[28px] border border-amber-200 bg-amber-50 px-6 py-6 text-amber-900 shadow-soft">
            <h2 className="text-lg font-semibold">{blocker?.title}</h2>
            <p className="mt-2 text-sm">{blocker?.description}</p>
            <p className="mt-2 text-sm">
              This screen is read-only and cannot write configuration for you.
            </p>
            <p className="mt-1 text-sm">
              Fix the Core connection in the existing integration flow, then retry inspection here.
            </p>
            <button
              type="button"
              onClick={() => {
                void refreshActiveTab();
              }}
              className="mt-4 inline-flex items-center rounded-2xl bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600">
              Retry
            </button>
          </section>
        ) : (
          <>
            <section className="rounded-[28px] border border-stone-200 bg-white p-4 shadow-soft dark:border-neutral-800 dark:bg-neutral-900">
              <div role="tablist" aria-label="Core registries" className="flex flex-wrap gap-3">
                {REGISTRY_TABS.map(tab => {
                  const selected = tab === activeTab;
                  return (
                    <button
                      key={tab}
                      id={tabId(tab)}
                      ref={node => {
                        tabRefs.current[tab] = node;
                      }}
                      type="button"
                      role="tab"
                      aria-controls={tabPanelId(tab)}
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => {
                        void setTab(tab);
                      }}
                      onKeyDown={event => {
                        void handleTabKeyDown(event, tab);
                      }}
                      className={`inline-flex items-center rounded-2xl px-4 py-2 text-sm font-medium transition ${
                        selected
                          ? 'bg-stone-900 text-white dark:bg-white dark:text-neutral-900'
                          : 'border border-stone-200 text-stone-700 hover:bg-stone-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800'
                      }`}>
                      {formatLiteral(tab)}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                {REGISTRY_TABS.map(tab => (
                  <span
                    key={`${tab}-summary`}
                    className="inline-flex items-center rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-[11px] font-medium text-stone-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                    {tabSummary(tab, state.tabs[tab].summaryState)}
                  </span>
                ))}
              </div>
            </section>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
              <section
                id={tabPanelId(activeTab)}
                role="tabpanel"
                aria-labelledby={tabId(activeTab)}
                className="space-y-6"
                tabIndex={0}>
                {activeTab === 'agents' ? (
                  <RegistryCollectionPane
                    title="Agents"
                    description="Published agent records. No record is auto-selected."
                    observation={state.tabs.agents.collections.agents.observation}
                    items={agentItems}
                    hasMore={hasMore(state.tabs.agents.collections.agents.nextCursor)}
                    loadMoreLabel="Load more agents"
                    onLoadMore={() => {
                      void loadMoreCollection('agents');
                    }}
                    onRetry={() => {
                      void retryCollection('agents');
                    }}
                  />
                ) : null}

                {activeTab === 'tools' ? (
                  <div className="grid gap-6 xl:grid-cols-2">
                    <RegistryCollectionPane
                      title="Definitions"
                      description="Published tool contracts, distinct from permission enablements."
                      observation={state.tabs.tools.collections.toolDefinitions.observation}
                      items={toolItems}
                      hasMore={hasMore(state.tabs.tools.collections.toolDefinitions.nextCursor)}
                      loadMoreLabel="Load more definitions"
                      onLoadMore={() => {
                        void loadMoreCollection('toolDefinitions');
                      }}
                      onRetry={() => {
                        void retryCollection('toolDefinitions');
                      }}
                    />
                    <RegistryCollectionPane
                      title="Enablements"
                      description="Permission gates and runtime approval limits for tools."
                      observation={state.tabs.tools.collections.toolEnablements.observation}
                      items={enablementItems}
                      onRetry={() => {
                        void retryCollection('toolEnablements');
                      }}
                    />
                  </div>
                ) : null}

                {activeTab === 'connectors' ? (
                  <div className="grid gap-6 xl:grid-cols-2">
                    <RegistryCollectionPane
                      title="Types"
                      description="Published connector types and normalization contracts."
                      observation={state.tabs.connectors.collections.connectorTypes.observation}
                      items={connectorTypeItems}
                      hasMore={hasMore(state.tabs.connectors.collections.connectorTypes.nextCursor)}
                      loadMoreLabel="Load more types"
                      onLoadMore={() => {
                        void loadMoreCollection('connectorTypes');
                      }}
                      onRetry={() => {
                        void retryCollection('connectorTypes');
                      }}
                    />
                    <RegistryCollectionPane
                      title="Bindings"
                      description="Bound provider accounts and capability selections."
                      observation={state.tabs.connectors.collections.connectorBindings.observation}
                      items={connectorBindingItems}
                      hasMore={hasMore(
                        state.tabs.connectors.collections.connectorBindings.nextCursor
                      )}
                      loadMoreLabel="Load more bindings"
                      onLoadMore={() => {
                        void loadMoreCollection('connectorBindings');
                      }}
                      onRetry={() => {
                        void retryCollection('connectorBindings');
                      }}
                    />
                  </div>
                ) : null}
              </section>

              {isWideLayout ? (
                <aside className="block">
                  <div className="sticky top-8">
                    <RegistryDetailPane
                      activeTab={activeTab}
                      detailState={detailState}
                      state={state}
                      onOpenDetail={openDetail}
                    />
                  </div>
                </aside>
              ) : null}
            </div>
          </>
        )}
      </div>

      {!isWideLayout && detailState.kind !== 'none' ? (
        <RegistryDetailDrawer title={selectedDetailTitle} onClose={closeDetail}>
          <RegistryDetailPane
            activeTab={activeTab}
            detailState={detailState}
            state={state}
            onOpenDetail={openDetail}
          />
        </RegistryDetailDrawer>
      ) : null}
    </div>
  );
}
