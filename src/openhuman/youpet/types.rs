use serde::{Deserialize, Deserializer, Serialize};
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
