import { useT } from '../../lib/i18n/I18nContext';
import type {
  AgentRegistryAgent,
  ConnectorRegistryBinding,
  ConnectorRegistryType,
  ToolRegistryToolDefinition,
  ToolRegistryToolEnablement,
} from '../../services/api/coreRegistriesClient';
import ReadOnlyJson from './ReadOnlyJson';
import type {
  RegistryDetailRef,
  RegistryDetailState,
  RegistryInspectionState,
  RegistryTab,
} from './types';

interface RegistryDetailPaneProps {
  activeTab: RegistryTab;
  detailState: RegistryDetailState;
  state: RegistryInspectionState;
  onOpenDetail: (detail: RegistryDetailRef) => void | Promise<void>;
}

function formatLiteral(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'Not available';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function shortFingerprint(value: string): string {
  return value.slice(0, 12);
}

function canResolveToolDefinition(
  state: RegistryInspectionState,
  toolKey: string,
  version: number
) {
  const collection = state.tabs.tools.collections.toolDefinitions;
  const match = collection.items.find(item => item.toolKey === toolKey && item.version === version);
  return { match, observation: collection.observation.kind };
}

function canResolveToolEnablement(state: RegistryInspectionState, toolKey: string) {
  return (
    state.tabs.tools.collections.toolEnablements.items.find(item => item.toolKey === toolKey) ??
    null
  );
}

function canResolveConnectorType(
  state: RegistryInspectionState,
  connectorKey: string,
  version: number
) {
  const collection = state.tabs.connectors.collections.connectorTypes;
  const match = collection.items.find(
    item => item.connectorKey === connectorKey && item.version === version
  );
  return { match, observation: collection.observation.kind };
}

async function copyText(value: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard can be unavailable inside Tauri webviews; ignore.
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-3xl border border-stone-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-sm font-semibold text-stone-900 dark:text-neutral-100">{title}</h3>
      {children}
    </section>
  );
}

function FieldList({ entries }: { entries: Array<[label: string, value: React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-2 text-sm">
      {entries.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-stone-500 dark:text-neutral-400">{label}</dt>
          <dd className="min-w-0 text-stone-800 dark:text-neutral-100">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FingerprintRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
      <span className="font-mono text-xs text-stone-700 dark:text-neutral-200">
        {label} · {shortFingerprint(value)}
      </span>
      <button
        type="button"
        onClick={() => {
          void copyText(value);
        }}
        aria-label="Copy full fingerprint"
        className="inline-flex items-center rounded-xl border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-700 transition hover:bg-white dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
        Copy full fingerprint
      </button>
    </div>
  );
}

function ReferenceButton({
  label,
  detail,
  onOpenDetail,
}: {
  label: string;
  detail: RegistryDetailRef;
  onOpenDetail: (detail: RegistryDetailRef) => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        void onOpenDetail(detail);
      }}
      className="inline-flex items-center rounded-xl border border-primary-200 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700 transition hover:bg-primary-100">
      {label}
    </button>
  );
}

function UnresolvedReference({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
      Unresolved: {label}
    </span>
  );
}

function DeferredReference({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-xl border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm text-stone-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
      Load the target tab to inspect {label}.
    </span>
  );
}

function AgentDetail({
  record,
  state,
  onOpenDetail,
}: {
  record: AgentRegistryAgent;
  state: RegistryInspectionState;
  onOpenDetail: (detail: RegistryDetailRef) => void | Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <FingerprintRow label="Fingerprint" value={record.configurationFingerprint} />

      <Section title="Agent lifecycle">
        <FieldList
          entries={[
            ['Lifecycle', formatLiteral(record.lifecycleState)],
            ['Owner', `${formatLiteral(record.ownerActorType)} · ${record.ownerActorId}`],
            ['Created', formatDate(record.createdAt)],
          ]}
        />
        <p className="text-sm text-stone-600 dark:text-neutral-300">
          Active records are publish states, not runtime permission grants.
        </p>
      </Section>

      <Section title="Exact tool references">
        <div className="flex flex-wrap gap-2">
          {record.configuration.allowedToolRefs.length === 0 ? (
            <p className="text-sm text-stone-500 dark:text-neutral-400">
              No exact tool references are declared.
            </p>
          ) : (
            record.configuration.allowedToolRefs.map(ref => {
              const resolution = canResolveToolDefinition(state, ref.toolKey, ref.version);
              const label = `${ref.toolKey} v${ref.version}`;
              if (resolution.match) {
                return (
                  <ReferenceButton
                    key={label}
                    label={label}
                    detail={{ kind: 'tool-definition', key: ref.toolKey, version: ref.version }}
                    onOpenDetail={onOpenDetail}
                  />
                );
              }
              if (
                resolution.observation === 'loaded' ||
                resolution.observation === 'stale' ||
                resolution.observation === 'empty' ||
                resolution.observation === 'blocked'
              ) {
                return <UnresolvedReference key={label} label={label} />;
              }
              return <DeferredReference key={label} label={label} />;
            })
          )}
        </div>
      </Section>

      <Section title="Logical reference warnings">
        <p className="text-sm text-stone-600 dark:text-neutral-300">
          Logical references need follow-up outside this read-only view.
        </p>
        <FieldList
          entries={[
            [
              'Knowledge scopes',
              record.configuration.knowledgeScopeRefs.length === 0
                ? 'None'
                : record.configuration.knowledgeScopeRefs
                    .map(ref => `${ref.sourceKey}@${ref.trustVersion} (${ref.accessScope})`)
                    .join(', '),
            ],
            [
              'Risk policy',
              record.configuration.riskPolicyRef
                ? `${record.configuration.riskPolicyRef.policyId}@${record.configuration.riskPolicyRef.policyVersion}`
                : 'None',
            ],
          ]}
        />
      </Section>

      <Section title="Configuration">
        <ReadOnlyJson value={record.configuration} />
      </Section>
    </div>
  );
}

function ToolDefinitionDetail({
  record,
  state,
  onOpenDetail,
}: {
  record: ToolRegistryToolDefinition;
  state: RegistryInspectionState;
  onOpenDetail: (detail: RegistryDetailRef) => void | Promise<void>;
}) {
  const enablement = canResolveToolEnablement(state, record.toolKey);
  const enablementLabel = enablement
    ? enablement.lifecycleState === 'enabled'
      ? 'Enabled'
      : 'Disabled'
    : 'Missing enablement';

  return (
    <div className="space-y-4">
      <FingerprintRow label="Fingerprint" value={record.definitionFingerprint} />

      <Section title="Definition lifecycle">
        <FieldList
          entries={[
            ['Lifecycle', formatLiteral(record.lifecycleState)],
            ['Effect class', formatLiteral(record.toolEffectClass)],
            ['Schema version', String(record.schemaVersion)],
            ['Enablement', enablementLabel],
          ]}
        />
        <p className="text-sm text-stone-600 dark:text-neutral-300">
          Active records are publish states, not runtime permission grants.
        </p>
        {enablement ? (
          <ReferenceButton
            label={`${enablement.toolKey} v${enablement.version}`}
            detail={{
              kind: 'tool-enablement',
              key: enablement.toolKey,
              version: enablement.version,
            }}
            onOpenDetail={onOpenDetail}
          />
        ) : null}
      </Section>

      <Section title="Schemas">
        <ReadOnlyJson
          value={{
            inputSchema: record.inputSchema,
            outputSchema: record.outputSchema,
            timeoutDefaults: record.timeoutDefaults,
            retryContract: record.retryContract,
            auditContract: record.auditContract,
          }}
        />
      </Section>
    </div>
  );
}

function ToolEnablementDetail({
  record,
  state,
  onOpenDetail,
}: {
  record: ToolRegistryToolEnablement;
  state: RegistryInspectionState;
  onOpenDetail: (detail: RegistryDetailRef) => void | Promise<void>;
}) {
  const resolution = canResolveToolDefinition(state, record.toolKey, record.version);

  return (
    <div className="space-y-4">
      <Section title="Enablement lifecycle">
        <FieldList
          entries={[
            ['Lifecycle', formatLiteral(record.lifecycleState)],
            ['Generation', String(record.generation)],
            ['Approval required', record.approvalRequired ? 'Yes' : 'No'],
            ['Audit mode', record.auditMode ? formatLiteral(record.auditMode) : 'Not set'],
            ['Timeout cap', record.timeoutCapMs ? `${record.timeoutCapMs} ms` : 'Not set'],
            ['Allow TTL', record.allowTtlSeconds ? `${record.allowTtlSeconds}s` : 'Not set'],
            ['Updated', formatDate(record.updatedAt)],
          ]}
        />
        <p className="text-sm text-stone-600 dark:text-neutral-300">
          Enablement records express permission gates, not definition publication state.
        </p>
      </Section>

      <Section title="Definition link">
        {resolution.match ? (
          <ReferenceButton
            label={`${record.toolKey} v${record.version}`}
            detail={{ kind: 'tool-definition', key: record.toolKey, version: record.version }}
            onOpenDetail={onOpenDetail}
          />
        ) : resolution.observation === 'loaded' ||
          resolution.observation === 'stale' ||
          resolution.observation === 'empty' ||
          resolution.observation === 'blocked' ? (
          <UnresolvedReference label={`${record.toolKey} v${record.version}`} />
        ) : (
          <DeferredReference label={`${record.toolKey} v${record.version}`} />
        )}
      </Section>
    </div>
  );
}

function ConnectorTypeDetail({ record }: { record: ConnectorRegistryType }) {
  return (
    <div className="space-y-4">
      <FingerprintRow label="Fingerprint" value={record.connectorTypeFingerprint} />

      <Section title="Type lifecycle">
        <FieldList
          entries={[
            ['Lifecycle', formatLiteral(record.lifecycleState)],
            ['Source type', record.sourceType],
            ['Capabilities', record.capabilities.join(', ') || 'None'],
            ['Created', formatDate(record.createdAt)],
          ]}
        />
      </Section>

      <Section title="Contracts">
        <ReadOnlyJson
          value={{
            normalizationContracts: record.normalizationContracts,
            deliveryBehavior: record.deliveryBehavior,
          }}
        />
      </Section>
    </div>
  );
}

function ConnectorBindingDetail({
  record,
  state,
  onOpenDetail,
}: {
  record: ConnectorRegistryBinding;
  state: RegistryInspectionState;
  onOpenDetail: (detail: RegistryDetailRef) => void | Promise<void>;
}) {
  const resolution = canResolveConnectorType(
    state,
    record.connectorTypeKey,
    record.connectorTypeVersion
  );

  return (
    <div className="space-y-4">
      <FingerprintRow label="Fingerprint" value={record.bindingFingerprint} />

      <Section title="Binding lifecycle">
        <FieldList
          entries={[
            ['Lifecycle', formatLiteral(record.lifecycleState)],
            [
              'Provider account',
              `${record.providerAccount.namespace} · ${record.providerAccount.externalAccountRef}`,
            ],
            ['Capabilities', record.enabledCapabilities.join(', ') || 'None'],
            ['Created', formatDate(record.createdAt)],
          ]}
        />
      </Section>

      <Section title="Exact connector type">
        {resolution.match ? (
          <ReferenceButton
            label={`${record.connectorTypeKey} v${record.connectorTypeVersion}`}
            detail={{
              kind: 'connector-type',
              key: record.connectorTypeKey,
              version: record.connectorTypeVersion,
            }}
            onOpenDetail={onOpenDetail}
          />
        ) : resolution.observation === 'loaded' ||
          resolution.observation === 'stale' ||
          resolution.observation === 'empty' ||
          resolution.observation === 'blocked' ? (
          <UnresolvedReference
            label={`${record.connectorTypeKey} v${record.connectorTypeVersion}`}
          />
        ) : (
          <DeferredReference label={`${record.connectorTypeKey} v${record.connectorTypeVersion}`} />
        )}
      </Section>

      <Section title="Logical reference warnings">
        <p className="text-sm text-stone-600 dark:text-neutral-300">
          Logical references need follow-up outside this read-only view.
        </p>
        <FieldList
          entries={[
            ['Config ref', record.configRef],
            ['Credential ref', record.credentialRef],
          ]}
        />
      </Section>
    </div>
  );
}

export default function RegistryDetailPane({
  activeTab: _activeTab,
  detailState,
  state,
  onOpenDetail,
}: RegistryDetailPaneProps) {
  const { t } = useT();

  if (detailState.kind === 'none') {
    return (
      <div className="rounded-3xl border border-dashed border-stone-300 bg-stone-50 px-5 py-6 text-sm text-stone-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
        {t('registries.detail.empty', 'Select a record to inspect its exact registry version.')}
      </div>
    );
  }

  if (detailState.kind === 'loading') {
    return (
      <div className="rounded-3xl border border-stone-200 bg-white px-5 py-6 text-sm text-stone-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        Loading exact registry detail...
      </div>
    );
  }

  if (detailState.kind === 'missing') {
    return (
      <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-6 text-sm text-amber-800">
        Core reported that this exact record version no longer exists.
      </div>
    );
  }

  if (detailState.kind === 'error') {
    return (
      <div className="rounded-3xl border border-coral-200 bg-coral-50 px-5 py-6 text-sm text-coral-800">
        Core could not load this exact record right now.
      </div>
    );
  }

  const { detail, record } = detailState;
  const title = `${detail.key} v${detail.version}`;

  return (
    <div className="space-y-4">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500 dark:text-neutral-400">
          {formatLiteral(detail.kind)}
        </p>
        <h3 className="mt-1 text-xl font-semibold text-stone-900 dark:text-neutral-100">{title}</h3>
      </header>

      {detail.kind === 'agent' ? (
        <AgentDetail
          record={record as AgentRegistryAgent}
          state={state}
          onOpenDetail={onOpenDetail}
        />
      ) : null}
      {detail.kind === 'tool-definition' ? (
        <ToolDefinitionDetail
          record={record as ToolRegistryToolDefinition}
          state={state}
          onOpenDetail={onOpenDetail}
        />
      ) : null}
      {detail.kind === 'tool-enablement' ? (
        <ToolEnablementDetail
          record={record as ToolRegistryToolEnablement}
          state={state}
          onOpenDetail={onOpenDetail}
        />
      ) : null}
      {detail.kind === 'connector-type' ? (
        <ConnectorTypeDetail record={record as ConnectorRegistryType} />
      ) : null}
      {detail.kind === 'connector-binding' ? (
        <ConnectorBindingDetail
          record={record as ConnectorRegistryBinding}
          state={state}
          onOpenDetail={onOpenDetail}
        />
      ) : null}
    </div>
  );
}
