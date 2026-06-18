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
