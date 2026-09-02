use base64::Engine as _;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use crate::openhuman::youpet::invalid_request_error;

const DEFAULT_REGISTRY_LIMIT: i64 = 50;
const MAX_REGISTRY_LIMIT: i64 = 200;
const MAX_REGISTRY_KEY_LEN: usize = 128;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RegistryCursorListResponse<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

impl<'de, T> Deserialize<'de> for RegistryCursorListResponse<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct RawCursorListResponse<T> {
            items: Vec<T>,
            next_cursor: Value,
        }

        let raw = RawCursorListResponse::deserialize(deserializer)?;
        let next_cursor = match raw.next_cursor {
            Value::Null => None,
            Value::String(cursor) => Some(cursor),
            _ => {
                return Err(serde::de::Error::custom(
                    "next_cursor must be a string or null",
                ));
            }
        };
        Ok(Self {
            items: raw.items,
            next_cursor,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RegistryUnpagedListResponse<T> {
    pub items: Vec<T>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RegistryOwnerActorType {
    Service,
    User,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRegistryLifecycleState {
    Draft,
    Active,
    Retired,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolDefinitionLifecycleState {
    Draft,
    Active,
    Retired,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolEffectClass {
    ReadOnly,
    Effectful,
    Destructive,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolEnablementLifecycleState {
    Enabled,
    Disabled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolEnablementAuditMode {
    MetadataOnly,
    RedactedIo,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorTypeLifecycleState {
    Draft,
    Active,
    Retired,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorBindingLifecycleState {
    Draft,
    Active,
    Retired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentOwnerRef {
    pub actor_type: String,
    pub actor_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolRefV1 {
    pub tool_key: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KnowledgeScopeRefV1 {
    pub scope_key: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyRefV1 {
    pub policy_id: String,
    pub policy_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentConfigurationV1 {
    pub schema_version: i64,
    pub domain_key: String,
    pub owner: AgentOwnerRef,
    pub allowed_tool_refs: Vec<ToolRefV1>,
    pub knowledge_scope_refs: Vec<KnowledgeScopeRefV1>,
    pub risk_policy_ref: Option<PolicyRefV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentRegistryAgentSummary {
    pub id: String,
    pub agent_key: String,
    pub version: i64,
    pub lifecycle_state: AgentRegistryLifecycleState,
    pub configuration_fingerprint: String,
    pub owner_actor_type: RegistryOwnerActorType,
    pub owner_actor_id: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentRegistryAgent {
    pub id: String,
    pub agent_key: String,
    pub version: i64,
    pub lifecycle_state: AgentRegistryLifecycleState,
    pub configuration: AgentConfigurationV1,
    pub configuration_fingerprint: String,
    pub owner_actor_type: RegistryOwnerActorType,
    pub owner_actor_id: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolRegistryToolDefinitionSummary {
    pub tool_key: String,
    pub version: i64,
    pub lifecycle_state: ToolDefinitionLifecycleState,
    pub definition_fingerprint: String,
    pub schema_version: i64,
    pub display_name: String,
    pub description: String,
    pub tool_effect_class: ToolEffectClass,
    pub abstract_auth_scopes: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolRegistryToolDefinition {
    pub tool_key: String,
    pub version: i64,
    pub lifecycle_state: ToolDefinitionLifecycleState,
    pub definition_fingerprint: String,
    pub schema_version: i64,
    pub display_name: String,
    pub description: String,
    pub tool_effect_class: ToolEffectClass,
    pub abstract_auth_scopes: Vec<String>,
    pub input_schema: Value,
    pub output_schema: Value,
    pub timeout_defaults: Value,
    pub retry_contract: Value,
    pub audit_contract: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolRegistryToolEnablement {
    pub tool_key: String,
    pub version: i64,
    pub lifecycle_state: ToolEnablementLifecycleState,
    pub generation: i64,
    pub timeout_cap_ms: Option<i64>,
    pub approval_required: bool,
    pub allow_ttl_seconds: Option<i64>,
    pub audit_mode: Option<ToolEnablementAuditMode>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectorRegistryTypeSummary {
    pub connector_key: String,
    pub version: i64,
    pub lifecycle_state: ConnectorTypeLifecycleState,
    pub source_type: String,
    pub connector_type_fingerprint: String,
    pub capabilities: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectorNormalizationContract {
    pub evidence_family: String,
    pub kernel_event_type: String,
    pub kernel_event_schema_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConnectorRegistryType {
    pub connector_key: String,
    pub version: i64,
    pub lifecycle_state: ConnectorTypeLifecycleState,
    pub source_type: String,
    pub connector_type_fingerprint: String,
    pub capabilities: Vec<String>,
    pub normalization_contracts: Vec<ConnectorNormalizationContract>,
    pub delivery_behavior: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectorRegistryProviderAccount {
    pub namespace: String,
    pub external_account_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectorRegistryBindingSummary {
    pub binding_key: String,
    pub version: i64,
    pub lifecycle_state: ConnectorBindingLifecycleState,
    pub connector_type_key: String,
    pub connector_type_version: i64,
    pub connector_type_fingerprint: String,
    pub enabled_capabilities: Vec<String>,
    pub binding_fingerprint: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectorRegistryBinding {
    pub binding_key: String,
    pub version: i64,
    pub lifecycle_state: ConnectorBindingLifecycleState,
    pub connector_type_key: String,
    pub connector_type_version: i64,
    pub connector_type_fingerprint: String,
    pub provider_account: ConnectorRegistryProviderAccount,
    pub config_ref: String,
    pub credential_ref: String,
    pub enabled_capabilities: Vec<String>,
    pub binding_fingerprint: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryListAgentsRpcParams {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
}

impl RegistryListAgentsRpcParams {
    pub fn validate(&self) -> Result<(), String> {
        validate_cursor_list_params(self.limit, self.cursor.as_deref(), CursorKind::Agent)
    }

    pub fn limit_or_default(&self) -> i64 {
        self.limit.unwrap_or(DEFAULT_REGISTRY_LIMIT)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryGetAgentVersionRpcParams {
    pub agent_key: String,
    pub version: i64,
}

impl RegistryGetAgentVersionRpcParams {
    pub fn validate(&self) -> Result<(), String> {
        validate_exact_params("agentKey", &self.agent_key, self.version)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryListToolDefinitionsRpcParams {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
}

impl RegistryListToolDefinitionsRpcParams {
    pub fn validate(&self) -> Result<(), String> {
        validate_cursor_list_params(
            self.limit,
            self.cursor.as_deref(),
            CursorKind::ToolDefinition,
        )
    }

    pub fn limit_or_default(&self) -> i64 {
        self.limit.unwrap_or(DEFAULT_REGISTRY_LIMIT)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryGetToolDefinitionVersionRpcParams {
    pub tool_key: String,
    pub version: i64,
}

impl RegistryGetToolDefinitionVersionRpcParams {
    pub fn validate(&self) -> Result<(), String> {
        validate_exact_params("toolKey", &self.tool_key, self.version)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct RegistryListToolEnablementsRpcParams {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryGetToolEnablementVersionRpcParams {
    pub tool_key: String,
    pub version: i64,
}

impl RegistryGetToolEnablementVersionRpcParams {
    pub fn validate(&self) -> Result<(), String> {
        validate_exact_params("toolKey", &self.tool_key, self.version)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryListConnectorTypesRpcParams {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
}

impl RegistryListConnectorTypesRpcParams {
    pub fn validate(&self) -> Result<(), String> {
        validate_cursor_list_params(
            self.limit,
            self.cursor.as_deref(),
            CursorKind::ConnectorType,
        )
    }

    pub fn limit_or_default(&self) -> i64 {
        self.limit.unwrap_or(DEFAULT_REGISTRY_LIMIT)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryGetConnectorTypeVersionRpcParams {
    pub connector_key: String,
    pub version: i64,
}

impl RegistryGetConnectorTypeVersionRpcParams {
    pub fn validate(&self) -> Result<(), String> {
        validate_exact_params("connectorKey", &self.connector_key, self.version)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryListConnectorBindingsRpcParams {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
}

impl RegistryListConnectorBindingsRpcParams {
    pub fn validate(&self) -> Result<(), String> {
        validate_cursor_list_params(
            self.limit,
            self.cursor.as_deref(),
            CursorKind::ConnectorBinding,
        )
    }

    pub fn limit_or_default(&self) -> i64 {
        self.limit.unwrap_or(DEFAULT_REGISTRY_LIMIT)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryGetConnectorBindingVersionRpcParams {
    pub binding_key: String,
    pub version: i64,
}

impl RegistryGetConnectorBindingVersionRpcParams {
    pub fn validate(&self) -> Result<(), String> {
        validate_exact_params("bindingKey", &self.binding_key, self.version)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CursorKind {
    Agent,
    ToolDefinition,
    ConnectorType,
    ConnectorBinding,
}

impl CursorKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::ToolDefinition => "tool_definition",
            Self::ConnectorType => "connector_type",
            Self::ConnectorBinding => "connector_binding",
        }
    }
}

#[derive(Debug, Deserialize)]
struct CursorEnvelope {
    after: Vec<Value>,
    kind: String,
    schema_version: i64,
}

fn validate_cursor_list_params(
    limit: Option<i64>,
    cursor: Option<&str>,
    expected_kind: CursorKind,
) -> Result<(), String> {
    validate_limit(limit)?;
    validate_cursor(cursor, expected_kind)
}

fn validate_limit(limit: Option<i64>) -> Result<(), String> {
    if let Some(value) = limit {
        if !(1..=MAX_REGISTRY_LIMIT).contains(&value) {
            return Err(invalid_request_error(
                "limit",
                "limit must be between 1 and 200",
            ));
        }
    }
    Ok(())
}

fn validate_cursor(cursor: Option<&str>, expected_kind: CursorKind) -> Result<(), String> {
    let Some(raw) = cursor.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(());
    };

    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(raw)
        .map_err(|_| invalid_request_error("cursor", "cursor must be base64url JSON"))?;
    let payload: CursorEnvelope = serde_json::from_slice(&decoded)
        .map_err(|_| invalid_request_error("cursor", "cursor must be canonical JSON"))?;
    if payload.schema_version != 1 {
        return Err(invalid_request_error(
            "cursor",
            "cursor schema_version must be 1",
        ));
    }
    if payload.kind != expected_kind.as_str() {
        return Err(invalid_request_error(
            "cursor",
            "cursor kind does not match this Registry collection",
        ));
    }
    if payload.after.len() != 2 {
        return Err(invalid_request_error(
            "cursor",
            "cursor after tuple must contain exactly two values",
        ));
    }
    Ok(())
}

fn validate_exact_params(field: &str, key: &str, version: i64) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err(invalid_request_error(field, "logical key is required"));
    }
    if trimmed.len() > MAX_REGISTRY_KEY_LEN {
        return Err(invalid_request_error(
            field,
            "logical key must be at most 128 characters",
        ));
    }
    if version < 1 {
        return Err(invalid_request_error("version", "version must be >= 1"));
    }
    Ok(())
}
