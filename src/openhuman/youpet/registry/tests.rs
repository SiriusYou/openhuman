use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, Method, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tempfile::TempDir;

use crate::openhuman::config::Config;
use crate::rpc::StructuredRpcError;

use super::{
    all_internal_controllers, registry_get_agent_version, registry_get_connector_binding_version,
    registry_get_connector_type_version, registry_get_tool_definition_version,
    registry_get_tool_enablement_version, registry_list_agents, registry_list_connector_bindings,
    registry_list_connector_types, registry_list_tool_definitions, registry_list_tool_enablements,
    registry_schemas, RegistryCursorListResponse, RegistryGetAgentVersionRpcParams,
    RegistryGetConnectorBindingVersionRpcParams, RegistryGetConnectorTypeVersionRpcParams,
    RegistryGetToolDefinitionVersionRpcParams, RegistryGetToolEnablementVersionRpcParams,
    RegistryListAgentsRpcParams, RegistryListConnectorBindingsRpcParams,
    RegistryListConnectorTypesRpcParams, RegistryListToolDefinitionsRpcParams,
};

#[derive(Debug, Clone)]
struct CapturedRequest {
    method: Method,
    path_and_query: String,
    authorization: Option<String>,
    actor: Option<String>,
}

type Requests = Arc<Mutex<Vec<CapturedRequest>>>;

fn test_config(tmp: &TempDir, base: String) -> Config {
    Config {
        workspace_dir: tmp.path().join("workspace"),
        config_path: tmp.path().join("config.toml"),
        youpet: crate::openhuman::config::YouPetConfig {
            core_api_url: base,
            service_token: Some("svc-token".into()),
            workbench_actor_id: "registry-reader".into(),
            operator_user_id: Some("22222222-2222-4222-8222-222222222222".into()),
            tenant_id: Some("20000000-0000-0000-0000-000000000001".into()),
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
    _body: Bytes,
) -> impl IntoResponse {
    requests.lock().unwrap().push(CapturedRequest {
        method,
        path_and_query: uri
            .path_and_query()
            .map(|value| value.as_str().to_string())
            .unwrap_or_else(|| uri.path().to_string()),
        authorization: headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string),
        actor: headers
            .get("x-actor-id")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string),
    });
    axum::Json(json!({ "ok": true }))
}

fn kind_cursor(kind: &str) -> String {
    use base64::Engine as _;

    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
        json!({
            "after": ["logical-key", 7],
            "kind": kind,
            "schema_version": 1
        })
        .to_string(),
    )
}

#[test]
fn registry_contract_exports_exactly_ten_internal_controllers() {
    let controllers = all_internal_controllers();
    let methods = controllers
        .iter()
        .map(|controller| controller.rpc_method_name())
        .collect::<Vec<_>>();
    assert_eq!(methods.len(), 10);
    assert_eq!(
        methods,
        vec![
            "openhuman.youpet_registry_list_agents",
            "openhuman.youpet_registry_get_agent_version",
            "openhuman.youpet_registry_list_tool_definitions",
            "openhuman.youpet_registry_get_tool_definition_version",
            "openhuman.youpet_registry_list_tool_enablements",
            "openhuman.youpet_registry_get_tool_enablement_version",
            "openhuman.youpet_registry_list_connector_types",
            "openhuman.youpet_registry_get_connector_type_version",
            "openhuman.youpet_registry_list_connector_bindings",
            "openhuman.youpet_registry_get_connector_binding_version",
        ]
    );
}

#[test]
fn registry_schemas_do_not_expose_authority_inputs() {
    let list_schema = registry_schemas("registry_list_agents");
    let input_names = list_schema
        .inputs
        .iter()
        .map(|field| field.name)
        .collect::<Vec<_>>();
    assert_eq!(input_names, vec!["limit", "cursor"]);
    for forbidden in [
        "tenantId",
        "coreUrl",
        "token",
        "actorId",
        "method",
        "path",
        "headers",
        "query",
    ] {
        assert!(
            !input_names.contains(&forbidden),
            "registry list schema must not expose {forbidden}"
        );
    }

    let exact_schema = registry_schemas("registry_get_connector_binding_version");
    let exact_names = exact_schema
        .inputs
        .iter()
        .map(|field| field.name)
        .collect::<Vec<_>>();
    assert_eq!(exact_names, vec!["bindingKey", "version"]);
}

#[test]
fn registry_params_reject_invalid_versions_and_cross_family_cursors() {
    let wrong_cursor = kind_cursor("connector_binding");
    let err = RegistryListAgentsRpcParams {
        limit: Some(50),
        cursor: Some(wrong_cursor),
    }
    .validate()
    .unwrap_err();
    let structured = StructuredRpcError::decode(&err).expect("structured error");
    assert_eq!(structured.message, "invalid Registry request");
    let data = structured.data.unwrap();
    assert_eq!(data["kind"], json!("YouPetRequestInvalid"));
    assert!(!data.to_string().contains("logical-key"));
    assert!(!data.to_string().contains("connector_binding"));

    let err = RegistryGetToolEnablementVersionRpcParams {
        tool_key: "tool.alpha".into(),
        version: 0,
    }
    .validate()
    .unwrap_err();
    let structured = StructuredRpcError::decode(&err).expect("structured error");
    assert_eq!(structured.message, "invalid Registry request");
    assert_eq!(structured.data.unwrap()["kind"], json!("YouPetRequestInvalid"));
}

#[tokio::test]
async fn registry_request_builders_use_exact_get_paths_and_headers() {
    let requests: Requests = Default::default();
    let app = Router::new()
        .route("/api/v1/kernel/agents", get(capture))
        .route(
            "/api/v1/kernel/agents/agent.alpha/versions/7",
            get(capture),
        )
        .route("/api/v1/kernel/tool-definitions", get(capture))
        .route(
            "/api/v1/kernel/tool-definitions/tool.alpha/versions/3",
            get(capture),
        )
        .route("/api/v1/kernel/tool-enablement", get(capture))
        .route(
            "/api/v1/kernel/tool-enablement/tool.alpha/versions/5",
            get(capture),
        )
        .route("/api/v1/kernel/connector-types", get(capture))
        .route(
            "/api/v1/kernel/connector-types/wecom/versions/2",
            get(capture),
        )
        .route("/api/v1/kernel/connector-bindings", get(capture))
        .route(
            "/api/v1/kernel/connector-bindings/wecom-primary/versions/11",
            get(capture),
        )
        .with_state(requests.clone());
    let base = spawn_mock(app).await;
    let tmp = TempDir::new().unwrap();
    let config = test_config(&tmp, base);

    let _ = registry_list_agents(
        &config,
        RegistryListAgentsRpcParams {
            limit: Some(50),
            cursor: Some(kind_cursor("agent")),
        },
    )
    .await;
    let _ = registry_get_agent_version(
        &config,
        RegistryGetAgentVersionRpcParams {
            agent_key: "agent.alpha".into(),
            version: 7,
        },
    )
    .await;
    let _ = registry_list_tool_definitions(
        &config,
        RegistryListToolDefinitionsRpcParams {
            limit: Some(50),
            cursor: Some(kind_cursor("tool_definition")),
        },
    )
    .await;
    let _ = registry_get_tool_definition_version(
        &config,
        RegistryGetToolDefinitionVersionRpcParams {
            tool_key: "tool.alpha".into(),
            version: 3,
        },
    )
    .await;
    let _ = registry_list_tool_enablements(&config).await;
    let _ = registry_get_tool_enablement_version(
        &config,
        RegistryGetToolEnablementVersionRpcParams {
            tool_key: "tool.alpha".into(),
            version: 5,
        },
    )
    .await;
    let _ = registry_list_connector_types(
        &config,
        RegistryListConnectorTypesRpcParams {
            limit: Some(50),
            cursor: Some(kind_cursor("connector_type")),
        },
    )
    .await;
    let _ = registry_get_connector_type_version(
        &config,
        RegistryGetConnectorTypeVersionRpcParams {
            connector_key: "wecom".into(),
            version: 2,
        },
    )
    .await;
    let _ = registry_list_connector_bindings(
        &config,
        RegistryListConnectorBindingsRpcParams {
            limit: Some(50),
            cursor: Some(kind_cursor("connector_binding")),
        },
    )
    .await;
    let _ = registry_get_connector_binding_version(
        &config,
        RegistryGetConnectorBindingVersionRpcParams {
            binding_key: "wecom-primary".into(),
            version: 11,
        },
    )
    .await;

    let requests = requests.lock().unwrap();
    assert_eq!(
        requests
            .iter()
            .map(|request| request.path_and_query.as_str())
            .collect::<Vec<_>>(),
        vec![
            "/api/v1/kernel/agents?limit=50&cursor=",
            "/api/v1/kernel/agents/agent.alpha/versions/7",
            "/api/v1/kernel/tool-definitions?limit=50&cursor=",
            "/api/v1/kernel/tool-definitions/tool.alpha/versions/3",
            "/api/v1/kernel/tool-enablement",
            "/api/v1/kernel/tool-enablement/tool.alpha/versions/5",
            "/api/v1/kernel/connector-types?limit=50&cursor=",
            "/api/v1/kernel/connector-types/wecom/versions/2",
            "/api/v1/kernel/connector-bindings?limit=50&cursor=",
            "/api/v1/kernel/connector-bindings/wecom-primary/versions/11",
        ]
    );
    assert!(requests.iter().all(|request| request.method == Method::GET));
    assert!(
        requests
            .iter()
            .all(|request| request.authorization.as_deref() == Some("Bearer svc-token"))
    );
    assert!(
        requests
            .iter()
            .all(|request| request.actor.as_deref() == Some("registry-reader"))
    );
}

#[tokio::test]
async fn registry_http_errors_preserve_retry_after_without_leaking_body() {
    let app = Router::new().route(
        "/api/v1/kernel/agents",
        get(|| async {
            (
                StatusCode::TOO_MANY_REQUESTS,
                [(axum::http::header::RETRY_AFTER, "2")],
                axum::Json(json!({
                    "detail": {
                        "code": "rate_limited",
                        "message": "secret provider ref",
                        "cursor": "agent-secret-cursor"
                    }
                })),
            )
        }),
    );
    let base = spawn_mock(app).await;
    let tmp = TempDir::new().unwrap();
    let config = test_config(&tmp, base);

    let err = registry_list_agents(
        &config,
        RegistryListAgentsRpcParams {
            limit: Some(50),
            cursor: None,
        },
    )
    .await
    .unwrap_err();
    let structured = StructuredRpcError::decode(&err).expect("structured error");
    let data = structured.data.unwrap();
    assert_eq!(structured.message, "YouPet Core request failed with HTTP 429");
    assert_eq!(data["kind"], json!("YouPetCoreHttpError"));
    assert_eq!(data["youpet"]["http_status"], json!(429));
    assert_eq!(data["youpet"]["code"], json!("rate_limited"));
    assert_eq!(data["youpet"]["retry_after_seconds"], json!(2));
    let rendered = data.to_string();
    assert!(!rendered.contains("secret provider ref"));
    assert!(!rendered.contains("agent-secret-cursor"));
    assert!(!rendered.contains("svc-token"));
}

#[test]
fn registry_decoding_requires_next_cursor_for_cursor_lists() {
    let parsed: RegistryCursorListResponse<Value> = serde_json::from_value(json!({
        "items": [],
        "next_cursor": null,
        "future_field": true
    }))
    .unwrap();
    assert!(parsed.next_cursor.is_none());

    let err = serde_json::from_value::<RegistryCursorListResponse<Value>>(json!({
        "items": []
    }))
    .unwrap_err();
    assert!(err.to_string().contains("next_cursor"));
}
