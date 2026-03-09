use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    sync::{atomic::AtomicU64, Arc},
    time::Duration,
};

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response, Sse},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use futures::{Stream, StreamExt};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, Mutex};

use crate::{
    checkpoint_store::CheckpointStore,
    logtail_store::LogTailStore,
    models::{KlaxonAction, KlaxonForm, KlaxonLevel},
    queue_store::QueueStore,
    scratchpad_store::ScratchpadStore,
    store::{KlaxonStore, StoreEvent},
    timer_store::TimerStore,
    token_store::{TokenDelta, TokenStore},
    toollog_store::{ToolCallEntry, ToolLogStore},
};

#[derive(Debug, Clone, Serialize)]
pub struct AgentInfo {
    pub client_id: String,
    pub last_seen: String,
    pub last_tool: Option<String>,
    pub calls_today: u64,
    #[serde(skip)]
    pub calls_date: String,
}

#[derive(Clone)]
pub struct McpState {
    pub store: Arc<KlaxonStore>,
    pub timer: Arc<TimerStore>,
    pub tokens: Arc<TokenStore>,
    pub scratchpad: Arc<ScratchpadStore>,
    pub checkpoints: Arc<CheckpointStore>,
    pub logtail: Arc<LogTailStore>,
    pub tool_log: Arc<ToolLogStore>,
    pub queue: Arc<QueueStore>,
    pub bearer: String,
    pub agents: Arc<Mutex<HashMap<String, AgentInfo>>>,
    pub agent_events: broadcast::Sender<()>,
    pub sessions: Arc<Mutex<HashSet<String>>>,
    pub sse_event_counter: Arc<AtomicU64>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcPayload {
    One(JsonRpcRequest),
    Batch(Vec<JsonRpcRequest>),
}

#[derive(Debug, Deserialize, Clone)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Option<serde_json::Value>,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: &'static str,
    pub id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

fn err(id: serde_json::Value, code: i32, message: impl Into<String>) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(JsonRpcError { code, message: message.into(), data: None }),
    }
}

fn ok(id: serde_json::Value, result: serde_json::Value) -> JsonRpcResponse {
    JsonRpcResponse { jsonrpc: "2.0", id, result: Some(result), error: None }
}

fn unauthorized() -> Response {
    (StatusCode::UNAUTHORIZED, "Unauthorized").into_response()
}

fn check_auth(headers: &HeaderMap, bearer: &str) -> bool {
    let Some(v) = headers.get(axum::http::header::AUTHORIZATION) else {
        return false;
    };
    let Ok(s) = v.to_str() else {
        return false;
    };
    s.trim() == format!("Bearer {bearer}")
}

fn forbidden() -> Response {
    (StatusCode::FORBIDDEN, "Forbidden: invalid origin").into_response()
}

fn check_origin(headers: &HeaderMap) -> bool {
    let Some(v) = headers.get(axum::http::header::ORIGIN) else {
        return true; // absent = non-browser client
    };
    let Ok(s) = v.to_str() else {
        return false;
    };
    let s = s.trim();
    for prefix in ["http://127.0.0.1", "http://localhost"] {
        if s == prefix || s.starts_with(&format!("{prefix}:")) {
            return true;
        }
    }
    false
}

fn generate_session_id() -> String {
    let suffix: String =
        rand::thread_rng().sample_iter(&Alphanumeric).take(32).map(char::from).collect();
    format!("ses_{suffix}")
}

pub fn generate_bearer() -> String {
    let suffix: String =
        rand::thread_rng().sample_iter(&Alphanumeric).take(28).map(char::from).collect();
    format!("mcp_{suffix}")
}

#[allow(clippy::too_many_arguments)]
pub async fn start_mcp_server(
    store: Arc<KlaxonStore>,
    timer: Arc<TimerStore>,
    tokens: Arc<TokenStore>,
    scratchpad: Arc<ScratchpadStore>,
    checkpoints: Arc<CheckpointStore>,
    logtail: Arc<LogTailStore>,
    tool_log: Arc<ToolLogStore>,
    queue: Arc<QueueStore>,
    port: u16,
) -> anyhow::Result<(
    SocketAddr,
    String,
    Arc<Mutex<HashMap<String, AgentInfo>>>,
    broadcast::Receiver<()>,
)> {
    let bearer = generate_bearer();
    let agents: Arc<Mutex<HashMap<String, AgentInfo>>> = Arc::new(Mutex::new(HashMap::new()));
    let (agent_tx, agent_rx) = broadcast::channel(64);
    let state = McpState {
        store,
        timer,
        tokens,
        scratchpad,
        checkpoints,
        logtail,
        tool_log,
        queue,
        bearer: bearer.clone(),
        agents: agents.clone(),
        agent_events: agent_tx,
        sessions: Arc::new(Mutex::new(HashSet::new())),
        sse_event_counter: Arc::new(AtomicU64::new(0)),
    };

    let app = Router::new()
        .route("/mcp", post(handle_post).get(handle_sse).delete(handle_delete))
        .route("/mcp/discover", get(handle_discover))
        .route("/health", get(handle_health))
        .with_state(state);

    let addr: SocketAddr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let addr = listener.local_addr()?;

    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    Ok((addr, bearer, agents, agent_rx))
}

async fn handle_post(
    State(state): State<McpState>,
    headers: HeaderMap,
    Json(payload): Json<JsonRpcPayload>,
) -> Response {
    // Gap 1: Origin validation
    if !check_origin(&headers) {
        return forbidden();
    }
    if !check_auth(&headers, &state.bearer) {
        return unauthorized();
    }

    let wants_sse = headers
        .get(axum::http::header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.contains("text/event-stream"))
        .unwrap_or(false);

    let (reqs, is_batch) = match payload {
        JsonRpcPayload::One(r) => (vec![r], false),
        JsonRpcPayload::Batch(v) => (v, true),
    };

    // Gap 2: Session ID validation (skip for initialize requests)
    let has_initialize = reqs.iter().any(|r| r.method == "initialize");
    if !has_initialize {
        let session_hdr = headers
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        match session_hdr {
            None => {
                return (StatusCode::BAD_REQUEST, "Missing Mcp-Session-Id").into_response();
            }
            Some(sid) => {
                if !state.sessions.lock().await.contains(&sid) {
                    return (StatusCode::CONFLICT, "Invalid or expired session").into_response();
                }
            }
        }
    }

    // Track agent activity
    let client_id =
        headers.get("x-client-id").and_then(|v| v.to_str().ok()).unwrap_or("unknown").to_string();
    let last_tool = reqs
        .iter()
        .find(|r| r.method == "tools/call")
        .and_then(|r| r.params.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()));
    let had_tool_call = last_tool.is_some();
    {
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let mut agents = state.agents.lock().await;
        let entry = agents.entry(client_id.clone()).or_insert_with(|| AgentInfo {
            client_id: client_id.clone(),
            last_seen: Utc::now().to_rfc3339(),
            last_tool: None,
            calls_today: 0,
            calls_date: today.clone(),
        });
        entry.last_seen = Utc::now().to_rfc3339();
        if had_tool_call {
            entry.last_tool = last_tool;
            if entry.calls_date != today {
                entry.calls_date = today;
                entry.calls_today = 1;
            } else {
                entry.calls_today += 1;
            }
        }
    }
    let _ = state.agent_events.send(());

    // Gap 4: Return 202 for notification-only payloads
    let all_notifications = reqs.iter().all(|r| r.id.is_none());
    if all_notifications {
        return StatusCode::ACCEPTED.into_response();
    }

    let mut responses: Vec<JsonRpcResponse> = Vec::new();
    let mut new_session_id: Option<String> = None;
    for req in &reqs {
        if req.id.is_none() {
            continue;
        }
        let id = req.id.clone().unwrap_or(serde_json::Value::Null);
        if req.jsonrpc != "2.0" {
            responses.push(err(id, -32600, "Invalid JSON-RPC version"));
            continue;
        }
        let (res, session_id) = handle_method(&state, req, id, &client_id).await;
        if session_id.is_some() && new_session_id.is_none() {
            new_session_id = session_id;
        }
        responses.push(res);
    }

    // Gap 4: Only use SSE when there's a tools/call that could produce follow-up events
    let has_tool_call = reqs.iter().any(|r| r.method == "tools/call");
    let use_sse = wants_sse && has_tool_call;

    if use_sse {
        let initial = if is_batch {
            serde_json::to_value(&responses).unwrap_or(serde_json::json!([]))
        } else {
            serde_json::to_value(responses.first()).unwrap_or(serde_json::json!(null))
        };

        // Gap 3: Merged notification stream from all stores
        let counter = state.sse_event_counter.clone();
        let notif_stream = merged_notification_stream(&state).map(move |notif| {
            let msg = notification_to_jsonrpc(&notif);
            let id = counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            Ok::<_, std::convert::Infallible>(sse_message_event_with_id(&msg, Some(id)))
        });

        let stream = futures::stream::once(async move {
            Ok::<_, std::convert::Infallible>(sse_message_event_with_id(&initial, None))
        })
        .chain(notif_stream);

        let mut response = Sse::new(stream)
            .keep_alive(
                axum::response::sse::KeepAlive::new()
                    .interval(Duration::from_secs(15))
                    .text("ping"),
            )
            .into_response();

        if let Some(sid) = new_session_id {
            response.headers_mut().insert(
                axum::http::HeaderName::from_static("mcp-session-id"),
                axum::http::HeaderValue::from_str(&sid).unwrap(),
            );
        }
        return response;
    }

    let mut response = if is_batch {
        Json(serde_json::to_value(responses).unwrap_or(serde_json::json!([]))).into_response()
    } else {
        Json(
            responses
                .into_iter()
                .next()
                .unwrap_or_else(|| err(serde_json::Value::Null, -32600, "Invalid request")),
        )
        .into_response()
    };

    // Gap 2: Set session ID header on response
    if let Some(sid) = new_session_id {
        response.headers_mut().insert(
            axum::http::HeaderName::from_static("mcp-session-id"),
            axum::http::HeaderValue::from_str(&sid).unwrap(),
        );
    }

    response
}

async fn handle_method(
    state: &McpState,
    req: &JsonRpcRequest,
    id: serde_json::Value,
    client_id: &str,
) -> (JsonRpcResponse, Option<String>) {
    match req.method.as_str() {
        "initialize" => {
            let session_id = generate_session_id();
            state.sessions.lock().await.insert(session_id.clone());
            (
                ok(
                    id,
                    serde_json::json!({
                      "protocolVersion": "2025-03-26",
                      "capabilities": {"tools": {}, "resources": {}, "prompts": {}},
                      "serverInfo": {"name": "klaxon-tauri-proto", "version": "0.2.0"}
                    }),
                ),
                Some(session_id),
            )
        }
        "tools/list" => (ok(
            id,
            serde_json::json!({
              "tools": [
                {
                  "name": "klaxon.notify",
                  "description": "Create a non-interactive klaxon notification",
                  "inputSchema": {
                    "type": "object",
                    "properties": {
                      "level": {"type": "string", "enum": ["info","warning","error","success"]},
                      "title": {"type": "string"},
                      "message": {"type": "string"},
                      "ttl_ms": {"type": "number"},
                      "actions": {"type":"array","items":{"type":"object"}}
                    },
                    "required": ["level","title","message"]
                  }
                },
                {
                  "name": "klaxon.ask",
                  "description": "Create an interactive klaxon question with a form schema",
                  "inputSchema": {
                    "type": "object",
                    "properties": {
                      "level": {"type": "string", "enum": ["info","warning","error","success"]},
                      "title": {"type": "string"},
                      "message": {"type": "string"},
                      "form": {"type": "object"},
                      "ttl_ms": {"type": "number"}
                    },
                    "required": ["level","title","message","form"]
                  }
                },
                {"name":"klaxon.ack","description":"Acknowledge a klaxon","inputSchema":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}},
                {"name":"klaxon.dismiss","description":"Dismiss a klaxon","inputSchema":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}},
                {"name":"timer.start","description":"Start tracking time on an issue","inputSchema":{"type":"object","properties":{"issue":{"type":"string"}},"required":["issue"]}},
                {"name":"timer.stop","description":"Stop the active timer","inputSchema":{"type":"object","properties":{}}},
                {"name":"timer.switch","description":"Stop current timer and start one for a new issue","inputSchema":{"type":"object","properties":{"issue":{"type":"string"}},"required":["issue"]}},
                {"name":"tokens.add","description":"Report token usage delta","inputSchema":{"type":"object","properties":{"model":{"type":"string"},"input_tokens":{"type":"number"},"output_tokens":{"type":"number"},"cost_usd":{"type":"number"},"source":{"type":"string"}},"required":["model","input_tokens","output_tokens"]}},
                {"name":"scratchpad.write","description":"Append a note to the shared scratchpad","inputSchema":{"type":"object","properties":{"content":{"type":"string"},"author":{"type":"string"}},"required":["content"]}},
                {"name":"checkpoint.create","description":"Record a milestone in the checkpoint tracker","inputSchema":{"type":"object","properties":{"label":{"type":"string"},"detail":{"type":"string"},"progress_pct":{"type":"number"},"session_tag":{"type":"string"}},"required":["label"]}},
                {"name":"logtail.append","description":"Append lines to the live log tail","inputSchema":{"type":"object","properties":{"lines":{"type":"array","items":{"type":"string"}},"stream":{"type":"string"}},"required":["lines"]}},
                {"name":"queue.push","description":"Push a work item onto the queue","inputSchema":{"type":"object","properties":{"title":{"type":"string"},"detail":{"type":"string"},"priority":{"type":"number"}},"required":["title"]}},
                {"name":"queue.update","description":"Update status of a work queue item","inputSchema":{"type":"object","properties":{"id":{"type":"number"},"status":{"type":"string"},"detail":{"type":"string"}},"required":["id","status"]}}
              ]
            }),
        ), None),
        "tools/call" => {
            let name = req.params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = req.params.get("arguments").cloned().unwrap_or(serde_json::json!({}));
            let call_start = std::time::Instant::now();

            let result = handle_tool(state, name, &args, id.clone()).await;
            let duration_ms = call_start.elapsed().as_millis() as u64;

            let args_summary = serde_json::to_string(&args)
                .map(|s| {
                    if s.chars().count() > 100 {
                        format!("{}…", s.chars().take(100).collect::<String>())
                    } else {
                        s
                    }
                })
                .unwrap_or_default();
            let entry_ok = result.error.is_none();
            let entry_err = result.error.as_ref().map(|e| e.message.clone());
            state
                .tool_log
                .record(ToolCallEntry {
                    tool: name.to_string(),
                    args_summary,
                    duration_ms,
                    ok: entry_ok,
                    error: entry_err,
                    client_id: client_id.to_string(),
                    called_at: Utc::now().to_rfc3339(),
                })
                .await;
            (result, None)
        }
        "resources/list" => (ok(
            id,
            serde_json::json!({
              "resources": [
                {"uri":"klaxon/open","name":"Open klaxons"},
                {"uri":"klaxon/item/{id}","name":"Klaxon item by id"},
                {"uri":"klaxon/answer/{id}","name":"Klaxon answer by id"},
                {"uri":"timer/active","name":"Active timer"},
                {"uri":"timer/today","name":"Today's timer summary"},
                {"uri":"tokens/today","name":"Today's token usage"}
              ]
            }),
        ), None),
        "resources/read" => {
            let Some(uri) = req.params.get("uri").and_then(|v| v.as_str()) else {
                return (err(id, -32602, "Missing uri"), None);
            };

            let res = if uri == "klaxon/open" {
                let items = state.store.list_open().await;
                ok(
                    id,
                    serde_json::json!({
                      "contents": [{"uri":"klaxon/open","mimeType":"application/json","text": serde_json::to_string(&items).unwrap_or("[]".into())}]
                    }),
                )
            } else if let Some(rest) = uri.strip_prefix("klaxon/item/") {
                let Ok(uuid) = uuid::Uuid::parse_str(rest) else {
                    return (err(id, -32602, "Invalid id"), None);
                };
                let item = state.store.get(uuid).await;
                ok(
                    id,
                    serde_json::json!({
                      "contents": [{"uri": uri, "mimeType":"application/json","text": serde_json::to_string(&item).unwrap_or("null".into())}]
                    }),
                )
            } else if let Some(rest) = uri.strip_prefix("klaxon/answer/") {
                let Ok(uuid) = uuid::Uuid::parse_str(rest) else {
                    return (err(id, -32602, "Invalid id"), None);
                };
                let ans = state.store.get_answer(uuid).await;
                ok(
                    id,
                    serde_json::json!({
                      "contents": [{"uri": uri, "mimeType":"application/json","text": serde_json::to_string(&ans).unwrap_or("null".into())}]
                    }),
                )
            } else if uri == "timer/active" {
                let active: Vec<_> = state.timer.active_state().await
          .into_iter().map(|(issue_id, start)| serde_json::json!({"issue_id": issue_id, "start": start.to_rfc3339()})).collect();
                ok(
                    id,
                    serde_json::json!({
                      "contents": [{"uri":"timer/active","mimeType":"application/json","text": serde_json::to_string(&active).unwrap_or("null".into())}]
                    }),
                )
            } else if uri == "timer/today" {
                let summary = state.timer.today_summary().await;
                ok(
                    id,
                    serde_json::json!({
                      "contents": [{"uri":"timer/today","mimeType":"application/json","text": serde_json::to_string(&summary).unwrap_or("[]".into())}]
                    }),
                )
            } else if uri == "tokens/today" {
                let totals = state.tokens.today_totals().await;
                ok(
                    id,
                    serde_json::json!({
                      "contents": [{"uri":"tokens/today","mimeType":"application/json","text": serde_json::to_string(&totals).unwrap_or("[]".into())}]
                    }),
                )
            } else {
                err(id, -32602, "Unknown uri")
            };
            (res, None)
        }
        _ => (err(id, -32601, format!("Unknown method: {}", req.method)), None),
    }
}

async fn handle_tool(
    state: &McpState,
    name: &str,
    args: &serde_json::Value,
    id: serde_json::Value,
) -> JsonRpcResponse {
    match name {
        "klaxon.notify" => match parse_notify_args(args) {
            Ok((level, title, message, ttl_ms, actions)) => {
                let it = state.store.notify(level, title, message, ttl_ms).await;
                if !actions.is_empty() {
                    let _ = state.store.set_actions(it.id, actions).await;
                }
                ok(
                    id,
                    serde_json::json!({"content":[{"type":"text","text":it.id.to_string()}],"id":it.id.to_string()}),
                )
            }
            Err(e) => err(id, -32602, e),
        },
        "klaxon.ask" => match parse_ask_args(args) {
            Ok((level, title, message, form, ttl_ms)) => {
                let it = state.store.ask(level, title, message, form, ttl_ms).await;
                ok(
                    id,
                    serde_json::json!({"content":[{"type":"text","text":it.id.to_string()}],"id":it.id.to_string()}),
                )
            }
            Err(e) => err(id, -32602, e),
        },
        "klaxon.ack" => {
            let Some(id_str) = args.get("id").and_then(|v| v.as_str()) else {
                return err(id, -32602, "Missing id");
            };
            let Ok(uuid) = uuid::Uuid::parse_str(id_str) else {
                return err(id, -32602, "Invalid id");
            };
            let _ = state.store.ack(uuid).await;
            ok(id, serde_json::json!({"ok": true}))
        }
        "klaxon.dismiss" => {
            let Some(id_str) = args.get("id").and_then(|v| v.as_str()) else {
                return err(id, -32602, "Missing id");
            };
            let Ok(uuid) = uuid::Uuid::parse_str(id_str) else {
                return err(id, -32602, "Invalid id");
            };
            let _ = state.store.dismiss(uuid).await;
            ok(id, serde_json::json!({"ok": true}))
        }
        "timer.start" => {
            let Some(issue) = args.get("issue").and_then(|v| v.as_str()) else {
                return err(id, -32602, "Missing issue");
            };
            match state.timer.start(issue.to_string()).await {
                Ok(()) => ok(id, serde_json::json!({"ok": true})),
                Err(e) => err(id, -32602, e),
            }
        }
        "timer.stop" => {
            let entries = if let Some(issue_id) = args.get("issue_id").and_then(|v| v.as_str()) {
                state.timer.stop(issue_id).await.into_iter().collect::<Vec<_>>()
            } else {
                state.timer.stop_all().await
            };
            ok(
                id,
                serde_json::json!({
                  "ok": true,
                  "stopped": serde_json::to_value(entries).unwrap_or(serde_json::json!([]))
                }),
            )
        }
        "timer.switch" => {
            let Some(issue) = args.get("issue").and_then(|v| v.as_str()) else {
                return err(id, -32602, "Missing issue");
            };
            let stopped = state.timer.switch(issue.to_string()).await;
            ok(
                id,
                serde_json::json!({
                  "ok": true,
                  "stopped": serde_json::to_value(stopped).unwrap_or(serde_json::json!([]))
                }),
            )
        }
        "tokens.add" => {
            let Some(model) = args.get("model").and_then(|v| v.as_str()) else {
                return err(id, -32602, "Missing model");
            };
            let Some(input_tokens) = args.get("input_tokens").and_then(|v| v.as_u64()) else {
                return err(id, -32602, "Missing input_tokens");
            };
            let Some(output_tokens) = args.get("output_tokens").and_then(|v| v.as_u64()) else {
                return err(id, -32602, "Missing output_tokens");
            };
            let cost_usd = args.get("cost_usd").and_then(|v| v.as_f64());
            let source = args.get("source").and_then(|v| v.as_str()).map(|s| s.to_string());
            state
                .tokens
                .add(TokenDelta {
                    model: model.to_string(),
                    input_tokens,
                    output_tokens,
                    cost_usd,
                    source,
                })
                .await;
            ok(id, serde_json::json!({"ok": true}))
        }
        "scratchpad.write" => {
            let Some(content) = args.get("content").and_then(|v| v.as_str()) else {
                return err(id, -32602, "Missing content");
            };
            let author = args.get("author").and_then(|v| v.as_str()).unwrap_or("agent").to_string();
            let entry = state.scratchpad.add(content.to_string(), author).await;
            ok(id, serde_json::json!({"ok": true, "id": entry.id}))
        }
        "checkpoint.create" => {
            let Some(label) = args.get("label").and_then(|v| v.as_str()) else {
                return err(id, -32602, "Missing label");
            };
            let detail = args.get("detail").and_then(|v| v.as_str()).map(|s| s.to_string());
            let progress_pct = args.get("progress_pct").and_then(|v| v.as_i64());
            let session_tag =
                args.get("session_tag").and_then(|v| v.as_str()).map(|s| s.to_string());
            let cp = state
                .checkpoints
                .create(label.to_string(), detail, progress_pct, session_tag)
                .await;
            ok(id, serde_json::json!({"ok": true, "id": cp.id}))
        }
        "logtail.append" => {
            let Some(lines_val) = args.get("lines").and_then(|v| v.as_array()) else {
                return err(id, -32602, "Missing lines array");
            };
            let lines: Vec<String> =
                lines_val.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
            let stream =
                args.get("stream").and_then(|v| v.as_str()).unwrap_or("stdout").to_string();
            state.logtail.append(lines, stream).await;
            ok(id, serde_json::json!({"ok": true}))
        }
        "queue.push" => {
            let Some(title) = args.get("title").and_then(|v| v.as_str()) else {
                return err(id, -32602, "Missing title");
            };
            let detail = args.get("detail").and_then(|v| v.as_str()).map(|s| s.to_string());
            let priority = args.get("priority").and_then(|v| v.as_i64()).unwrap_or(0);
            let item = state.queue.push(title.to_string(), detail, priority, None).await;
            ok(id, serde_json::json!({"ok": true, "id": item.id}))
        }
        "queue.update" => {
            let Some(item_id) = args.get("id").and_then(|v| v.as_i64()) else {
                return err(id, -32602, "Missing id");
            };
            let Some(status) = args.get("status").and_then(|v| v.as_str()) else {
                return err(id, -32602, "Missing status");
            };
            let detail = args.get("detail").and_then(|v| v.as_str()).map(|s| s.to_string());
            state.queue.update_status(item_id, status.to_string(), detail).await;
            ok(id, serde_json::json!({"ok": true}))
        }
        _ => err(id, -32601, format!("Unknown tool: {name}")),
    }
}

fn parse_level(v: &serde_json::Value) -> Result<KlaxonLevel, String> {
    let Some(s) = v.as_str() else {
        return Err("level must be a string".into());
    };
    match s {
        "info" => Ok(KlaxonLevel::Info),
        "warning" => Ok(KlaxonLevel::Warning),
        "error" => Ok(KlaxonLevel::Error),
        "success" => Ok(KlaxonLevel::Success),
        _ => Err("level must be one of info|warning|error|success".into()),
    }
}

type NotifyArgs = (KlaxonLevel, String, String, Option<u64>, Vec<KlaxonAction>);

fn parse_notify_args(args: &serde_json::Value) -> Result<NotifyArgs, String> {
    let level = parse_level(args.get("level").ok_or("Missing level")?)?;
    let title = args.get("title").and_then(|v| v.as_str()).ok_or("Missing title")?.to_string();
    let message =
        args.get("message").and_then(|v| v.as_str()).ok_or("Missing message")?.to_string();
    let ttl_ms = args.get("ttl_ms").and_then(|v| v.as_u64());
    let actions = args
        .get("actions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| serde_json::from_value::<KlaxonAction>(a.clone()).ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok((level, title, message, ttl_ms, actions))
}

fn parse_ask_args(
    args: &serde_json::Value,
) -> Result<(KlaxonLevel, String, String, KlaxonForm, Option<u64>), String> {
    let level = parse_level(args.get("level").ok_or("Missing level")?)?;
    let title = args.get("title").and_then(|v| v.as_str()).ok_or("Missing title")?.to_string();
    let message =
        args.get("message").and_then(|v| v.as_str()).ok_or("Missing message")?.to_string();
    let form_val = args.get("form").ok_or("Missing form")?;
    let form: KlaxonForm =
        serde_json::from_value(form_val.clone()).map_err(|e| format!("Invalid form: {e}"))?;
    let ttl_ms = args.get("ttl_ms").and_then(|v| v.as_u64());
    Ok((level, title, message, form, ttl_ms))
}

async fn handle_health() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

#[derive(Serialize)]
struct DiscoverResponse {
    url: String,
    bearer: String,
    protocol_version: &'static str,
}

async fn handle_discover(
    State(state): State<McpState>,
    headers: HeaderMap,
) -> Response {
    if !check_origin(&headers) {
        return forbidden();
    }
    Json(DiscoverResponse {
        url: "/mcp".to_string(),
        bearer: state.bearer.clone(),
        protocol_version: "2025-03-26",
    })
    .into_response()
}

async fn handle_sse(State(state): State<McpState>, headers: HeaderMap) -> Response {
    // Gap 1: Origin validation
    if !check_origin(&headers) {
        return forbidden();
    }
    if !check_auth(&headers, &state.bearer) {
        return unauthorized();
    }

    // Gap 2: Session ID validation
    let session_hdr = headers
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    match session_hdr {
        None => {
            return (StatusCode::BAD_REQUEST, "Missing Mcp-Session-Id").into_response();
        }
        Some(sid) => {
            if !state.sessions.lock().await.contains(&sid) {
                return (StatusCode::CONFLICT, "Invalid or expired session").into_response();
            }
        }
    }

    // Gap 3: Merged notification stream from all stores
    let counter = state.sse_event_counter.clone();
    let stream = merged_notification_stream(&state).map(move |notif| {
        let msg = notification_to_jsonrpc(&notif);
        let id = counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Ok::<_, std::convert::Infallible>(sse_message_event_with_id(&msg, Some(id)))
    });

    Sse::new(stream)
        .keep_alive(
            axum::response::sse::KeepAlive::new().interval(Duration::from_secs(15)).text("ping"),
        )
        .into_response()
}

async fn handle_delete(
    State(state): State<McpState>,
    headers: HeaderMap,
) -> Response {
    if !check_origin(&headers) {
        return forbidden();
    }
    if !check_auth(&headers, &state.bearer) {
        return unauthorized();
    }

    let Some(sid) = headers
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
    else {
        return (StatusCode::BAD_REQUEST, "Missing Mcp-Session-Id").into_response();
    };

    let removed = state.sessions.lock().await.remove(sid);
    if removed {
        (StatusCode::OK, "Session terminated").into_response()
    } else {
        (StatusCode::NOT_FOUND, "Session not found").into_response()
    }
}

fn jsonrpc_notification(method: &str, params: serde_json::Value) -> serde_json::Value {
    serde_json::json!({"jsonrpc": "2.0", "method": method, "params": params})
}

fn sse_message_event_with_id(
    msg: &serde_json::Value,
    id: Option<u64>,
) -> axum::response::sse::Event {
    let json = serde_json::to_string(msg).unwrap_or_else(|_| "{}".into());
    let mut event = axum::response::sse::Event::default().event("message").data(json);
    if let Some(id) = id {
        event = event.id(id.to_string());
    }
    event
}

fn broadcast_stream<T: Clone>(rx: broadcast::Receiver<T>) -> impl Stream<Item = T> {
    futures::stream::unfold(rx, |mut rx| async move {
        loop {
            match rx.recv().await {
                Ok(v) => return Some((v, rx)),
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => return None,
            }
        }
    })
}

enum McpNotification {
    Klaxon(StoreEvent),
    Timer,
    Token,
    Scratchpad,
    Checkpoint,
    LogTail,
    Queue,
    ToolLog,
}

fn merged_notification_stream(state: &McpState) -> impl Stream<Item = McpNotification> + Send {
    let klaxon = broadcast_stream(state.store.events.subscribe())
        .map(McpNotification::Klaxon)
        .boxed();
    let timer = broadcast_stream(state.timer.events.subscribe())
        .map(|_| McpNotification::Timer)
        .boxed();
    let token = broadcast_stream(state.tokens.events.subscribe())
        .map(|_| McpNotification::Token)
        .boxed();
    let scratchpad = broadcast_stream(state.scratchpad.events.subscribe())
        .map(|_| McpNotification::Scratchpad)
        .boxed();
    let checkpoint = broadcast_stream(state.checkpoints.events.subscribe())
        .map(|_| McpNotification::Checkpoint)
        .boxed();
    let logtail = broadcast_stream(state.logtail.events.subscribe())
        .map(|_| McpNotification::LogTail)
        .boxed();
    let queue = broadcast_stream(state.queue.events.subscribe())
        .map(|_| McpNotification::Queue)
        .boxed();
    let toollog = broadcast_stream(state.tool_log.events.subscribe())
        .map(|_| McpNotification::ToolLog)
        .boxed();

    futures::stream::select_all(vec![
        klaxon, timer, token, scratchpad, checkpoint, logtail, queue, toollog,
    ])
}

fn notification_to_jsonrpc(notif: &McpNotification) -> serde_json::Value {
    match notif {
        McpNotification::Klaxon(evt) => match evt {
            StoreEvent::Created(item) => jsonrpc_notification(
                "notifications/klaxon",
                serde_json::json!({"type":"created","item": item}),
            ),
            StoreEvent::Updated(item) => jsonrpc_notification(
                "notifications/klaxon",
                serde_json::json!({"type":"updated","item": item}),
            ),
            StoreEvent::Answered { id, response } => jsonrpc_notification(
                "notifications/klaxon",
                serde_json::json!({"type":"answered","id": id.to_string(), "response": response}),
            ),
        },
        McpNotification::Timer => {
            jsonrpc_notification("notifications/timer", serde_json::json!({"type":"updated"}))
        }
        McpNotification::Token => {
            jsonrpc_notification("notifications/tokens", serde_json::json!({"type":"updated"}))
        }
        McpNotification::Scratchpad => jsonrpc_notification(
            "notifications/scratchpad",
            serde_json::json!({"type":"updated"}),
        ),
        McpNotification::Checkpoint => jsonrpc_notification(
            "notifications/checkpoint",
            serde_json::json!({"type":"updated"}),
        ),
        McpNotification::LogTail => {
            jsonrpc_notification("notifications/logtail", serde_json::json!({"type":"updated"}))
        }
        McpNotification::Queue => {
            jsonrpc_notification("notifications/queue", serde_json::json!({"type":"updated"}))
        }
        McpNotification::ToolLog => {
            jsonrpc_notification("notifications/toollog", serde_json::json!({"type":"updated"}))
        }
    }
}
