use std::time::Duration;

use reqwest::{Client, Method, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::{json, Map, Value};
use uuid::Uuid;

use crate::openhuman::config::Config;
use crate::rpc::{RpcOutcome, StructuredRpcError};

use super::types::{
    AlertActionRpcParams, CoreWorkbenchAlert, CoreWorkbenchAlertsResponse, ListAlertsRpcParams,
    TraceAlertRpcParams, WorkbenchAlertTrace,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT_SECS: u64 = 10;
const CLIENT_SERVICE_KEY: &str = "youpet.core";

pub async fn list_alerts(
    config: &Config,
    params: ListAlertsRpcParams,
) -> Result<RpcOutcome<Vec<CoreWorkbenchAlert>>, String> {
    let client = youpet_client();
    let mut request = client.get(build_url(config, "/api/v1/workbench/alerts")?);
    if let Some(status) = params.status.as_query_param() {
        request = request.query(&[("status", status)]);
    }
    if let Some(severity) = params.severity {
        request = request.query(&[("severity", severity.as_str())]);
    }
    let response: CoreWorkbenchAlertsResponse = send_request(config, request).await?;
    Ok(RpcOutcome::single_log(
        response.items,
        "[youpet] listed Core workbench alerts",
    ))
}

pub async fn ack_alert(
    config: &Config,
    params: AlertActionRpcParams,
) -> Result<RpcOutcome<CoreWorkbenchAlert>, String> {
    let actor_user_id = required_operator_user_id(config)?;
    let mut body = Map::new();
    body.insert("actor_user_id".to_string(), json!(actor_user_id));
    if let Some(note) = params.note {
        body.insert("note".to_string(), json!(note));
    }
    let alert = send_alert_action(
        config,
        &params.alert_id,
        "ack",
        Value::Object(body),
        params.idempotency_key,
    )
    .await?;
    Ok(RpcOutcome::single_log(
        alert,
        "[youpet] acknowledged Core alert",
    ))
}

pub async fn resolve_alert(
    config: &Config,
    params: AlertActionRpcParams,
) -> Result<RpcOutcome<CoreWorkbenchAlert>, String> {
    let actor_user_id = required_operator_user_id(config)?;
    let mut body = Map::new();
    body.insert("actor_user_id".to_string(), json!(actor_user_id));
    if let Some(resolution) = params.resolution {
        body.insert("resolution".to_string(), json!(resolution));
    }
    let alert = send_alert_action(
        config,
        &params.alert_id,
        "resolve",
        Value::Object(body),
        params.idempotency_key,
    )
    .await?;
    Ok(RpcOutcome::single_log(
        alert,
        "[youpet] resolved Core alert",
    ))
}

pub async fn get_alert_trace(
    config: &Config,
    params: TraceAlertRpcParams,
) -> Result<RpcOutcome<WorkbenchAlertTrace>, String> {
    let client = youpet_client();
    let url = build_url(
        config,
        &format!(
            "/api/v1/workbench/alerts/{}/trace",
            urlencoding::encode(&params.alert_id)
        ),
    )?;
    let trace: WorkbenchAlertTrace = send_request(config, client.get(url)).await?;
    Ok(RpcOutcome::single_log(
        trace,
        "[youpet] loaded Core workbench alert trace",
    ))
}

async fn send_alert_action(
    config: &Config,
    alert_id: &str,
    action: &str,
    body: Value,
    idempotency_key: Option<String>,
) -> Result<CoreWorkbenchAlert, String> {
    let client = youpet_client();
    let key = idempotency_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let url = build_url(
        config,
        &format!(
            "/api/v1/alerts/{}/{}",
            urlencoding::encode(alert_id),
            action
        ),
    )?;
    let request = client
        .request(Method::POST, url)
        .header("Content-Type", "application/json")
        .header("Idempotency-Key", key)
        .json(&body);
    send_request(config, request).await
}

fn youpet_client() -> Client {
    crate::openhuman::config::build_runtime_proxy_client_with_timeouts(
        CLIENT_SERVICE_KEY,
        REQUEST_TIMEOUT.as_secs(),
        CONNECT_TIMEOUT_SECS,
    )
}

async fn send_request<T: DeserializeOwned>(
    config: &Config,
    request: reqwest::RequestBuilder,
) -> Result<T, String> {
    let token = config
        .youpet
        .service_token()
        .ok_or_else(|| config_error("youpet.service_token is required", "service_token"))?;
    let response = request
        .bearer_auth(token)
        .header("X-Actor-Id", config.youpet.workbench_actor_id())
        .send()
        .await
        .map_err(|e| transport_error(&e.to_string()))?;
    parse_response(response).await
}

async fn parse_response<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, String> {
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| transport_error(&e.to_string()))?;
    if !status.is_success() {
        let value = if text.trim().is_empty() {
            Value::Null
        } else {
            serde_json::from_str::<Value>(&text).unwrap_or(Value::Null)
        };
        return Err(http_error(status, value));
    }
    let value = if text.trim().is_empty() {
        Value::Object(Default::default())
    } else {
        serde_json::from_str::<Value>(&text).map_err(|e| {
            structured_error(
                "YouPet Core returned invalid JSON",
                "YouPetCoreInvalidJson",
                json!({ "parse_error": e.to_string() }),
                false,
            )
        })?
    };
    serde_json::from_value::<T>(value).map_err(|e| {
        structured_error(
            "YouPet Core response shape mismatch",
            "YouPetCoreResponseShape",
            json!({ "parse_error": e.to_string() }),
            false,
        )
    })
}

fn build_url(config: &Config, path: &str) -> Result<String, String> {
    let base = format!("{}/", config.youpet.normalized_core_api_url());
    let base = reqwest::Url::parse(&base).map_err(|e| {
        structured_error(
            "invalid YouPet Core API URL",
            "YouPetConfigInvalid",
            json!({ "field": "core_api_url", "error": e.to_string() }),
            true,
        )
    })?;
    base.join(path.trim_start_matches('/'))
        .map(|url| url.to_string())
        .map_err(|e| {
            structured_error(
                "invalid YouPet Core API path",
                "YouPetRequestInvalid",
                json!({ "path": path, "error": e.to_string() }),
                false,
            )
        })
}

fn http_error(status: StatusCode, body: Value) -> String {
    let detail = body.get("detail").and_then(Value::as_object);
    let code = detail
        .and_then(|d| d.get("code"))
        .and_then(Value::as_str)
        .unwrap_or("youpet_core_error");
    let message = format!("YouPet Core request failed with HTTP {}", status.as_u16());
    let expected_user_state = status.is_client_error();
    structured_error(
        &message,
        "YouPetCoreHttpError",
        json!({
            "http_status": status.as_u16(),
            "code": code,
        }),
        expected_user_state,
    )
}

fn required_operator_user_id(config: &Config) -> Result<&str, String> {
    config.youpet.operator_user_id().ok_or_else(|| {
        config_error(
            "youpet.operator_user_id is required for YouPet Workbench actions",
            "operator_user_id",
        )
    })
}

fn config_error(message: &str, field: &str) -> String {
    structured_error(
        message,
        "YouPetConfigMissing",
        json!({ "field": field }),
        true,
    )
}

fn transport_error(message: &str) -> String {
    structured_error(
        "YouPet Core request failed",
        "YouPetCoreTransport",
        json!({ "error": message }),
        false,
    )
}

fn structured_error(message: &str, kind: &str, data: Value, expected_user_state: bool) -> String {
    StructuredRpcError {
        message: message.to_string(),
        data: Some(json!({
            "kind": kind,
            "youpet": data,
        })),
        expected_user_state,
    }
    .encode()
}

#[cfg(test)]
mod tests {
    use super::super::types::{CoreAlertStatus, CoreAlertStatusFilter};
    use super::*;
    use axum::{
        body::Bytes,
        extract::State,
        http::{HeaderMap, Method},
        response::IntoResponse,
        routing::{get, post},
        Router,
    };
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;

    #[derive(Debug, Clone)]
    struct CapturedRequest {
        method: Method,
        path_and_query: String,
        authorization: Option<String>,
        actor: Option<String>,
        idempotency_key: Option<String>,
        body: Value,
    }

    type Requests = Arc<Mutex<Vec<CapturedRequest>>>;

    const TEST_ALERT_ID: &str = "11111111-1111-4111-8111-111111111111";
    const TEST_ACTOR_USER_ID: &str = "22222222-2222-4222-8222-222222222222";

    fn test_config(tmp: &TempDir, base: String) -> Config {
        Config {
            workspace_dir: tmp.path().join("workspace"),
            config_path: tmp.path().join("config.toml"),
            youpet: crate::openhuman::config::YouPetConfig {
                core_api_url: base,
                service_token: Some("svc-token".into()),
                workbench_actor_id: "operator-workbench".into(),
                operator_user_id: Some(TEST_ACTOR_USER_ID.into()),
            },
            ..Config::default()
        }
    }

    async fn spawn_mock(app: Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        loop {
            if tokio::net::TcpStream::connect(addr).await.is_ok() {
                break;
            }
            assert!(std::time::Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        format!("http://127.0.0.1:{}", addr.port())
    }

    async fn capture(
        State(requests): State<Requests>,
        method: Method,
        uri: axum::http::Uri,
        headers: HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        let parsed_body = if body.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&body).unwrap()
        };
        requests.lock().unwrap().push(CapturedRequest {
            method,
            path_and_query: uri
                .path_and_query()
                .map(|v| v.as_str().to_string())
                .unwrap_or_else(|| uri.path().to_string()),
            authorization: headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string),
            actor: headers
                .get("x-actor-id")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string),
            idempotency_key: headers
                .get("idempotency-key")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string),
            body: parsed_body,
        });
        axum::Json(json!({
            "id": TEST_ALERT_ID,
            "alert_type": "missed_checkin",
            "severity": "high",
            "related_type": "task_instance",
            "related_id": "task-1",
            "status": "acknowledged",
            "created_at": "2026-06-01T00:00:00Z",
            "future_field": "tolerated"
        }))
    }

    #[tokio::test]
    async fn list_alerts_sends_auth_actor_and_empty_status_filter() {
        let requests: Requests = Default::default();
        let app =
            Router::new()
                .route(
                    "/api/v1/workbench/alerts",
                    get(
                        |State(requests): State<Requests>,
                         uri: axum::http::Uri,
                         headers: HeaderMap| async move {
                            requests.lock().unwrap().push(CapturedRequest {
                                method: Method::GET,
                                path_and_query: uri.path_and_query().unwrap().as_str().to_string(),
                                authorization: headers
                                    .get("authorization")
                                    .and_then(|v| v.to_str().ok())
                                    .map(str::to_string),
                                actor: headers
                                    .get("x-actor-id")
                                    .and_then(|v| v.to_str().ok())
                                    .map(str::to_string),
                                idempotency_key: None,
                                body: Value::Null,
                            });
                            axum::Json(json!({
                                "items": [{
                                    "id": TEST_ALERT_ID,
                                    "alert_type": "missed_checkin",
                                    "severity": "critical",
                                    "related_type": "task_instance",
                                    "related_id": "task-1",
                                    "status": "open",
                                    "created_at": "2026-06-01T00:00:00Z",
                                    "unknown_future_field": true
                                }]
                            }))
                        },
                    ),
                )
                .with_state(requests.clone());
        let base = spawn_mock(app).await;
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, base);

        let outcome = list_alerts(
            &config,
            ListAlertsRpcParams {
                status: CoreAlertStatusFilter::All,
                severity: Some(super::super::types::CoreAlertSeverity::Critical),
            },
        )
        .await
        .unwrap();

        assert_eq!(outcome.value[0].id, TEST_ALERT_ID);
        let request = requests.lock().unwrap().pop().unwrap();
        assert_eq!(request.method, Method::GET);
        assert_eq!(
            request.path_and_query,
            "/api/v1/workbench/alerts?status=&severity=critical"
        );
        assert_eq!(request.authorization.as_deref(), Some("Bearer svc-token"));
        assert_eq!(request.actor.as_deref(), Some("operator-workbench"));
    }

    #[tokio::test]
    async fn get_alert_trace_sends_auth_actor_and_no_action_body() {
        let requests: Requests = Default::default();
        let route = format!("/api/v1/workbench/alerts/{TEST_ALERT_ID}/trace");
        let app = Router::new()
            .route(&route, get(capture_trace))
            .with_state(requests.clone());
        let base = spawn_mock(app).await;
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, base);

        let outcome = get_alert_trace(
            &config,
            TraceAlertRpcParams {
                alert_id: TEST_ALERT_ID.into(),
            },
        )
        .await
        .unwrap();

        assert_eq!(outcome.value.alert_id, TEST_ALERT_ID);
        assert_eq!(
            outcome
                .value
                .workflow
                .as_ref()
                .map(|workflow| workflow.id.as_str()),
            Some("plan-1")
        );
        assert_eq!(
            outcome.value.entries[0].id,
            "alert:11111111-1111-4111-8111-111111111111"
        );
        let request = requests.lock().unwrap().pop().unwrap();
        assert_eq!(request.method, Method::GET);
        assert_eq!(request.path_and_query, route);
        assert_eq!(request.authorization.as_deref(), Some("Bearer svc-token"));
        assert_eq!(request.actor.as_deref(), Some("operator-workbench"));
        assert_eq!(request.idempotency_key, None);
        assert_eq!(request.body, Value::Null);
    }

    async fn capture_trace(
        State(requests): State<Requests>,
        method: Method,
        uri: axum::http::Uri,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        requests.lock().unwrap().push(CapturedRequest {
            method,
            path_and_query: uri
                .path_and_query()
                .map(|v| v.as_str().to_string())
                .unwrap_or_else(|| uri.path().to_string()),
            authorization: headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string),
            actor: headers
                .get("x-actor-id")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string),
            idempotency_key: headers
                .get("idempotency-key")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string),
            body: Value::Null,
        });
        axum::Json(json!({
            "alert_id": TEST_ALERT_ID,
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
            "entries": [{
                "id": format!("alert:{TEST_ALERT_ID}"),
                "occurred_at": "2026-06-01T00:00:00Z",
                "kind": "alert_created",
                "source": "alerts",
                "title": "Alert created",
                "detail": null,
                "actor": null,
                "related_type": "task_instance",
                "related_id": "task-1",
                "severity": "high",
                "metadata": { "alert_type": "missed_checkin" }
            }]
        }))
    }

    #[tokio::test]
    async fn trace_404_is_expected_user_state() {
        let route = format!("/api/v1/workbench/alerts/{TEST_ALERT_ID}/trace");
        let app = Router::new().route(
            &route,
            get(|| async {
                (
                    StatusCode::NOT_FOUND,
                    axum::Json(json!({
                        "detail": {
                            "code": "not_found",
                            "message": "secret missing alert body"
                        }
                    })),
                )
            }),
        );
        let base = spawn_mock(app).await;
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, base);

        let err = get_alert_trace(
            &config,
            TraceAlertRpcParams {
                alert_id: TEST_ALERT_ID.into(),
            },
        )
        .await
        .unwrap_err();
        let structured = StructuredRpcError::decode(&err).expect("structured error");
        assert_eq!(
            structured.message,
            "YouPet Core request failed with HTTP 404"
        );
        assert!(
            structured.expected_user_state,
            "Core 404 trace lookup should surface as expected user/config state"
        );
        let data = structured.data.unwrap();
        assert_eq!(data["kind"], json!("YouPetCoreHttpError"));
        assert_eq!(data["youpet"]["code"], json!("not_found"));
        assert_eq!(data["youpet"]["http_status"], json!(404));
        assert!(!data.to_string().contains("secret missing alert body"));
    }

    #[tokio::test]
    async fn ack_generates_idempotency_key_when_omitted() {
        let requests: Requests = Default::default();
        let route = format!("/api/v1/alerts/{TEST_ALERT_ID}/ack");
        let app = Router::new()
            .route(&route, post(capture))
            .with_state(requests.clone());
        let base = spawn_mock(app).await;
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, base);

        let outcome = ack_alert(
            &config,
            AlertActionRpcParams {
                alert_id: TEST_ALERT_ID.into(),
                note: Some("Calling owner.".into()),
                resolution: None,
                idempotency_key: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(outcome.value.status, CoreAlertStatus::Acknowledged);
        let request = requests.lock().unwrap().pop().unwrap();
        assert_eq!(request.method, Method::POST);
        assert_eq!(request.body["actor_user_id"], json!(TEST_ACTOR_USER_ID));
        assert_eq!(request.body["note"], json!("Calling owner."));
        let key = request.idempotency_key.expect("idempotency key");
        Uuid::parse_str(&key).expect("uuid v4 formatted idempotency key");
    }

    #[tokio::test]
    async fn ack_omits_note_when_not_supplied() {
        let requests: Requests = Default::default();
        let route = format!("/api/v1/alerts/{TEST_ALERT_ID}/ack");
        let app = Router::new()
            .route(&route, post(capture))
            .with_state(requests.clone());
        let base = spawn_mock(app).await;
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, base);

        ack_alert(
            &config,
            AlertActionRpcParams {
                alert_id: TEST_ALERT_ID.into(),
                note: None,
                resolution: None,
                idempotency_key: Some("idem".into()),
            },
        )
        .await
        .unwrap();

        let request = requests.lock().unwrap().pop().unwrap();
        assert_eq!(request.body["actor_user_id"], json!(TEST_ACTOR_USER_ID));
        assert!(
            request.body.get("note").is_none(),
            "omitted note must not be serialized as JSON null"
        );
    }

    #[tokio::test]
    async fn ack_blank_idempotency_keys_fall_back_to_fresh_uuid_headers() {
        let requests: Requests = Default::default();
        let route = format!("/api/v1/alerts/{TEST_ALERT_ID}/ack");
        let app = Router::new()
            .route(&route, post(capture))
            .with_state(requests.clone());
        let base = spawn_mock(app).await;
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, base);

        for raw_key in ["", "   "] {
            ack_alert(
                &config,
                AlertActionRpcParams {
                    alert_id: TEST_ALERT_ID.into(),
                    note: None,
                    resolution: None,
                    idempotency_key: Some(raw_key.into()),
                },
            )
            .await
            .unwrap();
        }

        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        let empty_fallback = requests[0]
            .idempotency_key
            .as_deref()
            .expect("empty key fallback header");
        Uuid::parse_str(empty_fallback).expect("empty key fallback must be a UUID");
        let whitespace_fallback = requests[1]
            .idempotency_key
            .as_deref()
            .expect("whitespace key fallback header");
        Uuid::parse_str(whitespace_fallback).expect("whitespace key fallback must be a UUID");
        assert_ne!(
            empty_fallback, whitespace_fallback,
            "blank fallback keys must be generated per attempt"
        );
    }

    #[tokio::test]
    async fn ack_trims_supplied_idempotency_key_before_sending() {
        let requests: Requests = Default::default();
        let route = format!("/api/v1/alerts/{TEST_ALERT_ID}/ack");
        let app = Router::new()
            .route(&route, post(capture))
            .with_state(requests.clone());
        let base = spawn_mock(app).await;
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, base);

        ack_alert(
            &config,
            AlertActionRpcParams {
                alert_id: TEST_ALERT_ID.into(),
                note: None,
                resolution: None,
                idempotency_key: Some(" idem ".into()),
            },
        )
        .await
        .unwrap();

        let request = requests.lock().unwrap().pop().unwrap();
        assert_eq!(request.idempotency_key.as_deref(), Some("idem"));
    }

    #[tokio::test]
    async fn resolve_honors_supplied_idempotency_key() {
        let requests: Requests = Default::default();
        let route = format!("/api/v1/alerts/{TEST_ALERT_ID}/resolve");
        let app = Router::new()
            .route(&route, post(capture))
            .with_state(requests.clone());
        let base = spawn_mock(app).await;
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, base);

        resolve_alert(
            &config,
            AlertActionRpcParams {
                alert_id: TEST_ALERT_ID.into(),
                note: None,
                resolution: Some("done".into()),
                idempotency_key: Some("idem-supplied".into()),
            },
        )
        .await
        .unwrap();

        let request = requests.lock().unwrap().pop().unwrap();
        assert_eq!(request.body["resolution"], json!("done"));
        assert_eq!(request.idempotency_key.as_deref(), Some("idem-supplied"));
    }

    #[tokio::test]
    async fn resolve_omits_resolution_when_not_supplied() {
        let requests: Requests = Default::default();
        let route = format!("/api/v1/alerts/{TEST_ALERT_ID}/resolve");
        let app = Router::new()
            .route(&route, post(capture))
            .with_state(requests.clone());
        let base = spawn_mock(app).await;
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, base);

        resolve_alert(
            &config,
            AlertActionRpcParams {
                alert_id: TEST_ALERT_ID.into(),
                note: None,
                resolution: None,
                idempotency_key: Some("idem-supplied".into()),
            },
        )
        .await
        .unwrap();

        let request = requests.lock().unwrap().pop().unwrap();
        assert_eq!(request.body["actor_user_id"], json!(TEST_ACTOR_USER_ID));
        assert!(
            request.body.get("resolution").is_none(),
            "omitted resolution must not be serialized as JSON null"
        );
    }

    #[test]
    fn build_url_preserves_core_api_base_path_prefixes() {
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, "https://core.example.test/youpet".into());

        let url = build_url(&config, "/api/v1/workbench/alerts").unwrap();

        assert_eq!(
            url,
            "https://core.example.test/youpet/api/v1/workbench/alerts"
        );
    }

    #[tokio::test]
    async fn http_error_does_not_forward_core_response_body() {
        let app = Router::new().route(
            "/api/v1/workbench/alerts",
            get(|| async {
                (
                    StatusCode::BAD_GATEWAY,
                    axum::Json(json!({
                        "detail": {
                            "code": "core_failed",
                            "message": "sensitive upstream detail",
                            "internal_trace": "do-not-forward"
                        }
                    })),
                )
            }),
        );
        let base = spawn_mock(app).await;
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, base);

        let err = list_alerts(&config, ListAlertsRpcParams::default())
            .await
            .unwrap_err();
        let structured = StructuredRpcError::decode(&err).expect("structured error");
        assert_eq!(
            structured.message,
            "YouPet Core request failed with HTTP 502"
        );
        let data = structured.data.unwrap();
        assert_eq!(data["kind"], json!("YouPetCoreHttpError"));
        assert_eq!(data["youpet"]["code"], json!("core_failed"));
        assert_eq!(data["youpet"]["http_status"], json!(502));
        assert!(
            !structured.expected_user_state,
            "5xx Core failures must remain reportable"
        );
        assert!(
            data["youpet"].get("response_body").is_none(),
            "Core response body must not cross the renderer boundary"
        );
        assert!(!data.to_string().contains("do-not-forward"));
        assert!(!data.to_string().contains("sensitive upstream detail"));
    }

    #[tokio::test]
    async fn http_error_preserves_status_for_non_json_5xx_body() {
        let app = Router::new().route(
            "/api/v1/workbench/alerts",
            get(|| async {
                (
                    StatusCode::BAD_GATEWAY,
                    axum::response::Html("<html>proxy failed: do-not-forward-html</html>"),
                )
            }),
        );
        let base = spawn_mock(app).await;
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, base);

        let err = list_alerts(&config, ListAlertsRpcParams::default())
            .await
            .unwrap_err();
        let structured = StructuredRpcError::decode(&err).expect("structured error");
        assert_eq!(
            structured.message,
            "YouPet Core request failed with HTTP 502"
        );
        assert!(
            !structured.expected_user_state,
            "5xx Core failures must remain reportable"
        );
        let data = structured.data.unwrap();
        assert_eq!(data["kind"], json!("YouPetCoreHttpError"));
        assert_eq!(data["youpet"]["code"], json!("youpet_core_error"));
        assert_eq!(data["youpet"]["http_status"], json!(502));
        assert!(
            data["youpet"].get("response_body").is_none(),
            "Core response body must not cross the renderer boundary"
        );
        let data_string = data.to_string();
        assert!(!data_string.contains("do-not-forward-html"));
        assert!(!data_string.contains("parse_error"));
        assert!(!data_string.contains("YouPetCoreInvalidJson"));
    }

    #[tokio::test]
    async fn http_error_marks_fastapi_validation_detail_array_as_expected_user_state() {
        let route = format!("/api/v1/alerts/{TEST_ALERT_ID}/ack");
        let app = Router::new().route(
            &route,
            post(|| async {
                (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    axum::Json(json!({
                        "detail": [{
                            "type": "uuid_parsing",
                            "loc": ["body", "actor_user_id"],
                            "msg": "Input should be a valid UUID",
                            "input": "not-a-uuid-secret"
                        }]
                    })),
                )
            }),
        );
        let base = spawn_mock(app).await;
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, base);

        let err = ack_alert(
            &config,
            AlertActionRpcParams {
                alert_id: TEST_ALERT_ID.into(),
                note: None,
                resolution: None,
                idempotency_key: Some("idem".into()),
            },
        )
        .await
        .unwrap_err();
        let structured = StructuredRpcError::decode(&err).expect("structured error");
        assert_eq!(
            structured.message,
            "YouPet Core request failed with HTTP 422"
        );
        assert!(
            structured.expected_user_state,
            "4xx Core failures should be treated as expected user state"
        );
        let data = structured.data.unwrap();
        assert_eq!(data["kind"], json!("YouPetCoreHttpError"));
        assert_eq!(data["youpet"]["code"], json!("youpet_core_error"));
        assert_eq!(data["youpet"]["http_status"], json!(422));
        assert!(
            data["youpet"].get("response_body").is_none(),
            "Core response body must not cross the renderer boundary"
        );
        let data_string = data.to_string();
        assert!(!data_string.contains("not-a-uuid-secret"));
        assert!(!data_string.contains("Input should be a valid UUID"));
        assert!(!data_string.contains("actor_user_id"));
    }

    #[tokio::test]
    async fn http_error_marks_invalid_operator_reference_as_expected_user_state() {
        let route = format!("/api/v1/alerts/{TEST_ALERT_ID}/ack");
        let app = Router::new().route(
            &route,
            post(|| async {
                (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    axum::Json(json!({
                        "detail": {
                            "code": "invalid_reference",
                            "field": "actor_user_id",
                            "message": "unknown user"
                        }
                    })),
                )
            }),
        );
        let base = spawn_mock(app).await;
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, base);

        let err = ack_alert(
            &config,
            AlertActionRpcParams {
                alert_id: TEST_ALERT_ID.into(),
                note: None,
                resolution: None,
                idempotency_key: Some("idem".into()),
            },
        )
        .await
        .unwrap_err();
        let structured = StructuredRpcError::decode(&err).expect("structured error");
        assert_eq!(
            structured.message,
            "YouPet Core request failed with HTTP 422"
        );
        assert!(
            structured.expected_user_state,
            "Core invalid_reference should be expected config/user state"
        );
        let data = structured.data.unwrap();
        assert_eq!(data["kind"], json!("YouPetCoreHttpError"));
        assert_eq!(data["youpet"]["code"], json!("invalid_reference"));
        assert_eq!(data["youpet"]["http_status"], json!(422));
        assert!(
            data["youpet"].get("response_body").is_none(),
            "Core response body must not cross the renderer boundary"
        );
        assert!(!data.to_string().contains("unknown user"));
    }

    #[tokio::test]
    async fn success_non_json_body_is_structured_invalid_json() {
        let app = Router::new().route("/api/v1/workbench/alerts", get(|| async { "not-json" }));
        let base = spawn_mock(app).await;
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, base);

        let err = list_alerts(&config, ListAlertsRpcParams::default())
            .await
            .unwrap_err();
        let structured = StructuredRpcError::decode(&err).expect("structured error");
        assert_eq!(structured.message, "YouPet Core returned invalid JSON");
        assert_eq!(
            structured.data.unwrap()["kind"],
            json!("YouPetCoreInvalidJson")
        );
    }

    #[tokio::test]
    async fn response_shape_violation_is_structured_error() {
        let app = Router::new().route(
            "/api/v1/workbench/alerts",
            get(|| async { axum::Json(json!({ "items": [{ "id": "missing-required-fields" }] })) }),
        );
        let base = spawn_mock(app).await;
        let tmp = TempDir::new().unwrap();
        let config = test_config(&tmp, base);

        let err = list_alerts(&config, ListAlertsRpcParams::default())
            .await
            .unwrap_err();
        let structured = StructuredRpcError::decode(&err).expect("structured error");
        assert_eq!(structured.message, "YouPet Core response shape mismatch");
        assert_eq!(
            structured.data.unwrap()["kind"],
            json!("YouPetCoreResponseShape")
        );
    }

    #[tokio::test]
    async fn missing_service_token_is_structured_error() {
        let tmp = TempDir::new().unwrap();
        let mut config = test_config(&tmp, "http://127.0.0.1:1".into());
        config.youpet.service_token = None;

        let err = list_alerts(&config, ListAlertsRpcParams::default())
            .await
            .unwrap_err();
        let structured = StructuredRpcError::decode(&err).expect("structured error");
        assert_eq!(
            structured.data.unwrap()["kind"],
            json!("YouPetConfigMissing")
        );
    }

    #[tokio::test]
    async fn missing_operator_user_id_is_expected_config_error_for_actions() {
        let tmp = TempDir::new().unwrap();
        let mut config = test_config(&tmp, "http://127.0.0.1:1".into());
        config.youpet.operator_user_id = None;

        let err = ack_alert(
            &config,
            AlertActionRpcParams {
                alert_id: TEST_ALERT_ID.into(),
                note: None,
                resolution: None,
                idempotency_key: Some("idem".into()),
            },
        )
        .await
        .unwrap_err();
        let structured = StructuredRpcError::decode(&err).expect("structured error");
        assert_eq!(
            structured.message,
            "youpet.operator_user_id is required for YouPet Workbench actions"
        );
        assert!(
            structured.expected_user_state,
            "missing operator is a local config/user-state issue"
        );
        let data = structured.data.unwrap();
        assert_eq!(data["kind"], json!("YouPetConfigMissing"));
        assert_eq!(data["youpet"]["field"], json!("operator_user_id"));
    }
}
