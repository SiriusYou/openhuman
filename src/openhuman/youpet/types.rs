use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CoreAlertSeverity {
    Low,
    Medium,
    High,
    Critical,
}

impl CoreAlertSeverity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Critical => "critical",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CoreAlertStatus {
    Open,
    Acknowledged,
    Resolved,
    Dismissed,
}

impl CoreAlertStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Acknowledged => "acknowledged",
            Self::Resolved => "resolved",
            Self::Dismissed => "dismissed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CoreAlertStatusFilter {
    #[default]
    Omitted,
    All,
    Status(CoreAlertStatus),
}

impl CoreAlertStatusFilter {
    pub fn as_query_param(self) -> Option<&'static str> {
        match self {
            Self::Omitted => None,
            Self::All => Some(""),
            Self::Status(status) => Some(status.as_str()),
        }
    }
}

impl<'de> Deserialize<'de> for CoreAlertStatusFilter {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        match value {
            Value::Null => Ok(Self::All),
            Value::String(raw) => {
                if raw.trim().is_empty() {
                    Ok(Self::All)
                } else {
                    serde_json::from_value::<CoreAlertStatus>(Value::String(raw))
                        .map(Self::Status)
                        .map_err(serde::de::Error::custom)
                }
            }
            other => Err(serde::de::Error::custom(format!(
                "status must be null or a string, got {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoreWorkbenchAlertContext {
    pub pet: CoreWorkbenchPetContext,
    pub owner: CoreWorkbenchOwnerContext,
    pub health_plan: CoreWorkbenchHealthPlanContext,
    pub task: CoreWorkbenchTaskContext,
    #[serde(default)]
    pub latest_checkin: Option<CoreWorkbenchLatestCheckinContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoreWorkbenchPetContext {
    pub id: String,
    pub name: String,
    pub species: String,
    #[serde(default)]
    pub breed: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoreWorkbenchOwnerContext {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub phone: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoreWorkbenchHealthPlanContext {
    pub id: String,
    pub title: String,
    pub plan_type: String,
    pub status: String,
    #[serde(default)]
    pub openclaw_flow_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoreWorkbenchTaskContext {
    pub id: String,
    pub status: String,
    pub due_at: String,
    pub missed_count: i64,
    #[serde(default)]
    pub openclaw_flow_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoreWorkbenchLatestCheckinContext {
    pub id: String,
    pub submitted_at: String,
    #[serde(default)]
    pub submitted_by: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub status_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoreWorkbenchAlert {
    pub id: String,
    pub alert_type: String,
    pub severity: CoreAlertSeverity,
    pub related_type: String,
    pub related_id: String,
    pub status: CoreAlertStatus,
    #[serde(default)]
    pub assigned_to: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub acknowledged_at: Option<String>,
    #[serde(default)]
    pub resolved_at: Option<String>,
    #[serde(default)]
    pub context: Option<CoreWorkbenchAlertContext>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkbenchTraceEntryKind {
    AlertCreated,
    HealthPlanState,
    TaskState,
    CheckinReceived,
    ActionRequestProposed,
    ActionRequestApproved,
    ActionRequestRejected,
    ActionRequestExecution,
    AuditAction,
    OutboxEvent,
    OutboxDelivery,
    DeliveryFailed,
    DeliverySucceeded,
    DeliveryRecovered,
    DeliveryDeadLettered,
    Unknown(String),
}

impl WorkbenchTraceEntryKind {
    fn as_str(&self) -> &str {
        match self {
            Self::AlertCreated => "alert_created",
            Self::HealthPlanState => "health_plan_state",
            Self::TaskState => "task_state",
            Self::CheckinReceived => "checkin_received",
            Self::ActionRequestProposed => "action_request_proposed",
            Self::ActionRequestApproved => "action_request_approved",
            Self::ActionRequestRejected => "action_request_rejected",
            Self::ActionRequestExecution => "action_request_execution",
            Self::AuditAction => "audit_action",
            Self::OutboxEvent => "outbox_event",
            Self::OutboxDelivery => "outbox_delivery",
            Self::DeliveryFailed => "delivery_failed",
            Self::DeliverySucceeded => "delivery_succeeded",
            Self::DeliveryRecovered => "delivery_recovered",
            Self::DeliveryDeadLettered => "delivery_dead_lettered",
            Self::Unknown(value) => value.as_str(),
        }
    }
}

impl Serialize for WorkbenchTraceEntryKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for WorkbenchTraceEntryKind {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "alert_created" => Self::AlertCreated,
            "health_plan_state" => Self::HealthPlanState,
            "task_state" => Self::TaskState,
            "checkin_received" => Self::CheckinReceived,
            "action_request_proposed" => Self::ActionRequestProposed,
            "action_request_approved" => Self::ActionRequestApproved,
            "action_request_rejected" => Self::ActionRequestRejected,
            "action_request_execution" => Self::ActionRequestExecution,
            "audit_action" => Self::AuditAction,
            "outbox_event" => Self::OutboxEvent,
            "outbox_delivery" => Self::OutboxDelivery,
            "delivery_failed" => Self::DeliveryFailed,
            "delivery_succeeded" => Self::DeliverySucceeded,
            "delivery_recovered" => Self::DeliveryRecovered,
            "delivery_dead_lettered" => Self::DeliveryDeadLettered,
            _ => Self::Unknown(value),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkbenchTraceSource {
    Alerts,
    HealthPlans,
    TaskInstances,
    Checkins,
    ActionRequests,
    AuditLogs,
    EventOutbox,
    OutboxDeliveries,
    Unknown(String),
}

impl WorkbenchTraceSource {
    fn as_str(&self) -> &str {
        match self {
            Self::Alerts => "alerts",
            Self::HealthPlans => "health_plans",
            Self::TaskInstances => "task_instances",
            Self::Checkins => "checkins",
            Self::ActionRequests => "action_requests",
            Self::AuditLogs => "audit_logs",
            Self::EventOutbox => "event_outbox",
            Self::OutboxDeliveries => "outbox_deliveries",
            Self::Unknown(value) => value.as_str(),
        }
    }
}

impl Serialize for WorkbenchTraceSource {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for WorkbenchTraceSource {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "alerts" => Self::Alerts,
            "health_plans" => Self::HealthPlans,
            "task_instances" => Self::TaskInstances,
            "checkins" => Self::Checkins,
            "action_requests" => Self::ActionRequests,
            "audit_logs" => Self::AuditLogs,
            "event_outbox" => Self::EventOutbox,
            "outbox_deliveries" => Self::OutboxDeliveries,
            _ => Self::Unknown(value),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkbenchTraceWarningCode {
    TraceTruncated,
    UnsupportedRelatedType,
    MissingRelatedTask,
    MissingRelatedPlan,
    MissingRelatedEvent,
    MissingRelatedActionRequest,
    ActionRequestProjectionTruncated,
    InvalidActionRequestProjection,
    ActionRequestAuditsTruncated,
    ActionRequestEventsTruncated,
    ActionRequestDeliveriesTruncated,
    ActionRequestLinksTruncated,
    TraceReservedBudgetExceeded,
    Unknown(String),
}

impl WorkbenchTraceWarningCode {
    fn as_str(&self) -> &str {
        match self {
            Self::TraceTruncated => "trace_truncated",
            Self::UnsupportedRelatedType => "unsupported_related_type",
            Self::MissingRelatedTask => "missing_related_task",
            Self::MissingRelatedPlan => "missing_related_plan",
            Self::MissingRelatedEvent => "missing_related_event",
            Self::MissingRelatedActionRequest => "missing_related_action_request",
            Self::ActionRequestProjectionTruncated => "action_request_projection_truncated",
            Self::InvalidActionRequestProjection => "invalid_action_request_projection",
            Self::ActionRequestAuditsTruncated => "action_request_audits_truncated",
            Self::ActionRequestEventsTruncated => "action_request_events_truncated",
            Self::ActionRequestDeliveriesTruncated => "action_request_deliveries_truncated",
            Self::ActionRequestLinksTruncated => "action_request_links_truncated",
            Self::TraceReservedBudgetExceeded => "trace_reserved_budget_exceeded",
            Self::Unknown(value) => value.as_str(),
        }
    }
}

impl Serialize for WorkbenchTraceWarningCode {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for WorkbenchTraceWarningCode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "trace_truncated" => Self::TraceTruncated,
            "unsupported_related_type" => Self::UnsupportedRelatedType,
            "missing_related_task" => Self::MissingRelatedTask,
            "missing_related_plan" => Self::MissingRelatedPlan,
            "missing_related_event" => Self::MissingRelatedEvent,
            "missing_related_action_request" => Self::MissingRelatedActionRequest,
            "action_request_projection_truncated" => Self::ActionRequestProjectionTruncated,
            "invalid_action_request_projection" => Self::InvalidActionRequestProjection,
            "action_request_audits_truncated" => Self::ActionRequestAuditsTruncated,
            "action_request_events_truncated" => Self::ActionRequestEventsTruncated,
            "action_request_deliveries_truncated" => Self::ActionRequestDeliveriesTruncated,
            "action_request_links_truncated" => Self::ActionRequestLinksTruncated,
            "trace_reserved_budget_exceeded" => Self::TraceReservedBudgetExceeded,
            _ => Self::Unknown(value),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkbenchTraceSeverity {
    Low,
    Medium,
    High,
    Critical,
    Unknown(String),
}

impl WorkbenchTraceSeverity {
    fn as_str(&self) -> &str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Critical => "critical",
            Self::Unknown(value) => value.as_str(),
        }
    }
}

impl Serialize for WorkbenchTraceSeverity {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for WorkbenchTraceSeverity {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "low" => Self::Low,
            "medium" => Self::Medium,
            "high" => Self::High,
            "critical" => Self::Critical,
            _ => Self::Unknown(value),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkbenchTraceActor {
    #[serde(rename = "type")]
    pub actor_type: String,
    #[serde(default)]
    pub id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkbenchTraceEntry {
    pub id: String,
    pub occurred_at: String,
    pub kind: WorkbenchTraceEntryKind,
    pub source: WorkbenchTraceSource,
    pub title: String,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub actor: Option<WorkbenchTraceActor>,
    #[serde(default)]
    pub related_type: Option<String>,
    #[serde(default)]
    pub related_id: Option<String>,
    #[serde(default)]
    pub severity: Option<WorkbenchTraceSeverity>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkbenchTraceWarning {
    pub code: WorkbenchTraceWarningCode,
    pub message: String,
    #[serde(default)]
    pub source: Option<WorkbenchTraceSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkbenchWorkflowIdentity {
    #[serde(rename = "type")]
    pub workflow_type: String,
    pub id: String,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub openclaw_flow_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkbenchAlertTrace {
    pub alert_id: String,
    #[serde(default)]
    pub workflow: Option<WorkbenchWorkflowIdentity>,
    pub partial: bool,
    #[serde(default)]
    pub warnings: Vec<WorkbenchTraceWarning>,
    #[serde(default)]
    pub entries: Vec<WorkbenchTraceEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CoreWorkbenchAlertsResponse {
    pub items: Vec<CoreWorkbenchAlert>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListAlertsRpcParams {
    #[serde(default)]
    pub status: CoreAlertStatusFilter,
    #[serde(default)]
    pub severity: Option<CoreAlertSeverity>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertActionRpcParams {
    pub alert_id: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub resolution: Option<String>,
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceAlertRpcParams {
    pub alert_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn alert_status_and_severity_use_core_literals() {
        assert_eq!(
            serde_json::to_value(CoreAlertStatus::Acknowledged).unwrap(),
            json!("acknowledged")
        );
        assert_eq!(
            serde_json::to_value(CoreAlertSeverity::Critical).unwrap(),
            json!("critical")
        );
    }

    #[test]
    fn alert_shape_tolerates_unknown_fields_but_requires_required_fields() {
        let alert: CoreWorkbenchAlert = serde_json::from_value(json!({
            "id": "alert-1",
            "alert_type": "missed_checkin",
            "severity": "high",
            "related_type": "task_instance",
            "related_id": "task-1",
            "status": "open",
            "created_at": "2026-06-01T00:00:00Z",
            "future_field": "tolerated"
        }))
        .unwrap();
        assert_eq!(alert.id, "alert-1");

        let err = serde_json::from_value::<CoreWorkbenchAlert>(json!({
            "alert_type": "missed_checkin",
            "severity": "high",
            "related_type": "task_instance",
            "related_id": "task-1",
            "status": "open",
            "created_at": "2026-06-01T00:00:00Z"
        }))
        .unwrap_err();
        assert!(err.to_string().contains("id"));
    }

    #[test]
    fn alert_shape_accepts_optional_operational_context() {
        let alert: CoreWorkbenchAlert = serde_json::from_value(json!({
            "id": "alert-1",
            "alert_type": "missed_checkin",
            "severity": "high",
            "related_type": "task_instance",
            "related_id": "task-1",
            "status": "open",
            "created_at": "2026-06-01T00:00:00Z",
            "context": {
                "pet": {
                    "id": "pet-1",
                    "name": "Mochi",
                    "species": "cat",
                    "breed": null,
                    "status": "active"
                },
                "owner": {
                    "id": "owner-1",
                    "name": "Owner A",
                    "phone": null,
                    "status": "active"
                },
                "health_plan": {
                    "id": "plan-1",
                    "title": "Daily check-in",
                    "plan_type": "checkin",
                    "status": "active",
                    "openclaw_flow_id": "flow-plan-1"
                },
                "task": {
                    "id": "task-1",
                    "status": "missed",
                    "due_at": "2026-06-01T10:01:00Z",
                    "missed_count": 2,
                    "openclaw_flow_id": null
                },
                "latest_checkin": {
                    "id": "checkin-1",
                    "submitted_at": "2026-06-01T10:10:00Z",
                    "submitted_by": "owner-1",
                    "text": "Looks normal.",
                    "status_tags": ["normal"],
                    "future_field": "tolerated"
                },
                "future_context_field": true
            }
        }))
        .unwrap();

        let context = alert.context.expect("context");
        assert_eq!(context.pet.name, "Mochi");
        assert_eq!(
            context.health_plan.openclaw_flow_id.as_deref(),
            Some("flow-plan-1")
        );
        assert_eq!(
            context.latest_checkin.expect("latest check-in").status_tags,
            vec!["normal".to_string()]
        );

        let unsupported: CoreWorkbenchAlert = serde_json::from_value(json!({
            "id": "alert-2",
            "alert_type": "outbox_dead_letter",
            "severity": "high",
            "related_type": "event_outbox",
            "related_id": "event-1",
            "status": "open",
            "created_at": "2026-06-01T00:00:00Z",
            "context": null
        }))
        .unwrap();
        assert!(unsupported.context.is_none());
    }

    #[test]
    fn trace_shape_accepts_nullable_fields_warnings_metadata_and_unknowns() {
        let trace: WorkbenchAlertTrace = serde_json::from_value(json!({
            "alert_id": "alert-1",
            "workflow": {
                "type": "health_plan",
                "id": "plan-1",
                "task_id": "task-1",
                "openclaw_flow_id": "flow-plan-1"
            },
            "partial": true,
            "warnings": [{
                "code": "trace_truncated",
                "message": "Trace limited to 50 entries",
                "source": "event_outbox"
            }],
            "entries": [
                {
                    "id": "event:event-1",
                    "occurred_at": "2026-06-01T00:00:00Z",
                    "kind": "outbox_event",
                    "source": "event_outbox",
                    "title": "Event emitted",
                    "detail": null,
                    "actor": { "type": "system", "id": null },
                    "related_type": null,
                    "related_id": null,
                    "severity": null,
                    "metadata": {
                        "event_type": "task.checkin_received",
                        "delivery_state": ["pending", "acked"]
                    },
                    "future_field": "tolerated"
                },
                {
                    "id": "audit:ack-1",
                    "occurred_at": "2026-06-01T00:01:00Z",
                    "kind": "delivery_succeeded",
                    "source": "audit_logs",
                    "title": "Delivery succeeded",
                    "metadata": {
                        "consumer": "openclaw",
                        "attempts": 0,
                        "recovered": false
                    }
                }
            ]
        }))
        .unwrap();
        assert_eq!(
            trace.workflow.as_ref().map(|workflow| workflow.id.as_str()),
            Some("plan-1")
        );

        assert!(trace.partial);
        assert_eq!(
            trace.warnings[0].code,
            WorkbenchTraceWarningCode::TraceTruncated
        );
        assert_eq!(
            trace.warnings[0].source,
            Some(WorkbenchTraceSource::EventOutbox)
        );
        assert_eq!(trace.entries[0].kind, WorkbenchTraceEntryKind::OutboxEvent);
        assert_eq!(trace.entries[0].source, WorkbenchTraceSource::EventOutbox);
        assert_eq!(trace.entries[0].severity, None);
        assert_eq!(
            trace.entries[0].metadata["event_type"],
            json!("task.checkin_received")
        );
        assert_eq!(
            trace.entries[1].kind,
            WorkbenchTraceEntryKind::DeliverySucceeded
        );
        assert_eq!(trace.entries[1].source, WorkbenchTraceSource::AuditLogs);
        assert_eq!(trace.entries[1].metadata["attempts"], json!(0));
        assert_eq!(
            serde_json::to_value(&trace.entries[1].kind).unwrap(),
            json!("delivery_succeeded")
        );
    }

    #[test]
    fn trace_shape_accepts_action_request_literals() {
        let trace: WorkbenchAlertTrace = serde_json::from_value(json!({
            "alert_id": "alert-1",
            "partial": true,
            "warnings": [{
                "code": "action_request_projection_truncated",
                "message": "ActionRequest projection limited to the latest request",
                "source": "action_requests"
            }, {
                "code": "invalid_action_request_projection",
                "message": "ActionRequest document could not be projected",
                "source": "action_requests"
            }, {
                "code": "missing_related_action_request",
                "message": "alert related action_request was not found",
                "source": "action_requests"
            }, {
                "code": "action_request_links_truncated",
                "message": "ActionRequest link identifiers limited to 3 values",
                "source": "action_requests"
            }],
            "entries": [
                {
                    "id": "action-request:req-1:proposal",
                    "occurred_at": "2026-06-01T00:01:00Z",
                    "kind": "action_request_proposed",
                    "source": "action_requests",
                    "title": "ActionRequest proposed",
                    "metadata": { "action_request_id": "req-1" }
                },
                {
                    "id": "action-request:req-1:approved",
                    "occurred_at": "2026-06-01T00:02:00Z",
                    "kind": "action_request_approved",
                    "source": "action_requests",
                    "title": "ActionRequest approved",
                    "metadata": { "approval_state": "approved" }
                },
                {
                    "id": "action-request:req-2:rejected",
                    "occurred_at": "2026-06-01T00:03:00Z",
                    "kind": "action_request_rejected",
                    "source": "action_requests",
                    "title": "ActionRequest rejected",
                    "metadata": { "approval_state": "rejected" }
                },
                {
                    "id": "action-request:req-1:execution",
                    "occurred_at": "2026-06-01T00:04:00Z",
                    "kind": "action_request_execution",
                    "source": "action_requests",
                    "title": "ActionRequest execution succeeded",
                    "metadata": { "execution_state": "succeeded" }
                }
            ]
        }))
        .unwrap();

        assert_eq!(
            trace.warnings[0].code,
            WorkbenchTraceWarningCode::ActionRequestProjectionTruncated
        );
        assert_eq!(
            trace.warnings[0].source,
            Some(WorkbenchTraceSource::ActionRequests)
        );
        assert_eq!(
            trace.warnings[1].code,
            WorkbenchTraceWarningCode::InvalidActionRequestProjection
        );
        assert_eq!(
            trace.warnings[2].code,
            WorkbenchTraceWarningCode::MissingRelatedActionRequest
        );
        assert_eq!(
            trace.warnings[3].code,
            WorkbenchTraceWarningCode::ActionRequestLinksTruncated
        );
        assert_eq!(
            trace.warnings[1].source,
            Some(WorkbenchTraceSource::ActionRequests)
        );
        assert_eq!(
            trace.entries[0].kind,
            WorkbenchTraceEntryKind::ActionRequestProposed
        );
        assert_eq!(
            trace.entries[1].kind,
            WorkbenchTraceEntryKind::ActionRequestApproved
        );
        assert_eq!(
            trace.entries[2].kind,
            WorkbenchTraceEntryKind::ActionRequestRejected
        );
        assert_eq!(
            trace.entries[3].kind,
            WorkbenchTraceEntryKind::ActionRequestExecution
        );
        assert_eq!(
            trace.entries[0].source,
            WorkbenchTraceSource::ActionRequests
        );
        assert_eq!(
            serde_json::to_value(&trace.entries[0].kind).unwrap(),
            json!("action_request_proposed")
        );
    }

    #[test]
    fn trace_shape_tolerates_future_literals_without_dropping_the_trace() {
        let trace: WorkbenchAlertTrace = serde_json::from_value(json!({
            "alert_id": "alert-1",
            "partial": true,
            "warnings": [{
                "code": "future_warning",
                "message": "Future warning",
                "source": "future_source"
            }],
            "entries": [{
                "id": "future:1",
                "occurred_at": "2026-06-01T00:00:00Z",
                "kind": "future_kind",
                "source": "future_source",
                "title": "Future trace entry",
                "severity": "future_severity",
                "metadata": {}
            }]
        }))
        .unwrap();

        assert_eq!(
            trace.entries[0].kind,
            WorkbenchTraceEntryKind::Unknown("future_kind".to_string())
        );
        assert_eq!(
            trace.entries[0].source,
            WorkbenchTraceSource::Unknown("future_source".to_string())
        );
        assert_eq!(
            trace.warnings[0].code,
            WorkbenchTraceWarningCode::Unknown("future_warning".to_string())
        );
        assert_eq!(
            trace.warnings[0].source,
            Some(WorkbenchTraceSource::Unknown("future_source".to_string()))
        );
        assert_eq!(
            trace.entries[0].severity,
            Some(WorkbenchTraceSeverity::Unknown(
                "future_severity".to_string()
            ))
        );
        assert_eq!(
            serde_json::to_value(&trace.entries[0].kind).unwrap(),
            json!("future_kind")
        );
        assert_eq!(
            serde_json::to_value(trace.entries[0].severity.as_ref().unwrap()).unwrap(),
            json!("future_severity")
        );
    }

    #[test]
    fn trace_params_parse_camel_case_alert_id() {
        let payload: TraceAlertRpcParams = serde_json::from_value(json!({
            "alertId": "alert-1"
        }))
        .unwrap();
        assert_eq!(payload.alert_id, "alert-1");
    }

    #[test]
    fn status_filter_preserves_omitted_null_empty_and_specific() {
        let omitted: ListAlertsRpcParams = serde_json::from_value(json!({})).unwrap();
        assert_eq!(omitted.status, CoreAlertStatusFilter::Omitted);

        let all_from_null: ListAlertsRpcParams =
            serde_json::from_value(json!({ "status": null })).unwrap();
        assert_eq!(all_from_null.status, CoreAlertStatusFilter::All);

        let all_from_empty: ListAlertsRpcParams =
            serde_json::from_value(json!({ "status": " " })).unwrap();
        assert_eq!(all_from_empty.status, CoreAlertStatusFilter::All);

        let open: ListAlertsRpcParams =
            serde_json::from_value(json!({ "status": "open" })).unwrap();
        assert_eq!(
            open.status,
            CoreAlertStatusFilter::Status(CoreAlertStatus::Open)
        );
    }
}

// --- ActionRequest lifecycle (AOS-S1.M1.2.3) ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActionRequestLifecycleEnvelope {
    pub action_request: Value,
    pub row_version: i64,
    pub id: String,
    pub tenant_id: String,
    pub approval_state: String,
    pub execution_state: String,
    pub policy_outcome: String,
    pub correlation_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActionRequestListResponse {
    pub items: Vec<ActionRequestLifecycleEnvelope>,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListActionRequestsRpcParams {
    #[serde(default)]
    pub tenant_id: Option<String>,
    #[serde(default)]
    pub approval_state: Option<String>,
    #[serde(default)]
    pub execution_state: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GetActionRequestRpcParams {
    pub action_request_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActionRequestDecisionRpcParams {
    pub action_request_id: String,
    pub reason: String,
    pub expected_row_version: i64,
    /// Required stable per-intent key. Blank/missing is rejected so retries cannot silently mint a new UUID.
    pub idempotency_key: String,
}
