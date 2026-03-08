use std::{collections::HashMap, net::SocketAddr, sync::Arc, time::Duration};

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
  models::{KlaxonAction, KlaxonForm, KlaxonLevel},
  store::{KlaxonStore, StoreEvent},
  timer_store::TimerStore,
  token_store::{TokenDelta, TokenStore},
};

#[derive(Debug, Clone, Serialize)]
pub struct AgentInfo {
  pub client_id: String,
  pub last_seen: String,
  pub last_tool: Option<String>,
  pub calls_today: u64,
}

#[derive(Clone)]
pub struct McpState {
  pub store: Arc<KlaxonStore>,
  pub timer: Arc<TimerStore>,
  pub tokens: Arc<TokenStore>,
  pub bearer: String,
  pub agents: Arc<Mutex<HashMap<String, AgentInfo>>>,
  pub agent_events: broadcast::Sender<()>,
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
  let Some(v) = headers.get(axum::http::header::AUTHORIZATION) else { return false; };
  let Ok(s) = v.to_str() else { return false; };
  s.trim() == format!("Bearer {bearer}")
}

pub fn generate_bearer() -> String {
  let suffix: String = rand::thread_rng()
    .sample_iter(&Alphanumeric)
    .take(28)
    .map(char::from)
    .collect();
  format!("mcp_{suffix}")
}

pub async fn start_mcp_server(
  store: Arc<KlaxonStore>,
  timer: Arc<TimerStore>,
  tokens: Arc<TokenStore>,
  port: u16,
) -> anyhow::Result<(SocketAddr, String, Arc<Mutex<HashMap<String, AgentInfo>>>, broadcast::Receiver<()>)> {
  let bearer = generate_bearer();
  let agents: Arc<Mutex<HashMap<String, AgentInfo>>> = Arc::new(Mutex::new(HashMap::new()));
  let (agent_tx, agent_rx) = broadcast::channel(64);
  let state = McpState { store, timer, tokens, bearer: bearer.clone(), agents: agents.clone(), agent_events: agent_tx };

  let app = Router::new()
    .route("/mcp", post(handle_post).get(handle_sse))
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

  // Track agent activity
  let client_id = headers
    .get("x-client-id")
    .and_then(|v| v.to_str().ok())
    .unwrap_or("unknown")
    .to_string();
  let last_tool = reqs.iter()
    .find(|r| r.method == "tools/call")
    .and_then(|r| r.params.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()));
  let had_tool_call = last_tool.is_some();
  {
    let mut agents = state.agents.lock().await;
    let entry = agents.entry(client_id.clone()).or_insert_with(|| AgentInfo {
      client_id: client_id.clone(),
      last_seen: Utc::now().to_rfc3339(),
      last_tool: None,
      calls_today: 0,
    });
    entry.last_seen = Utc::now().to_rfc3339();
    if had_tool_call {
      entry.last_tool = last_tool;
      entry.calls_today += 1;
    }
  }
  let _ = state.agent_events.send(());

  let mut responses: Vec<JsonRpcResponse> = Vec::new();
  for req in reqs {
    if req.id.is_none() {
      continue;
    }
    let id = req.id.clone().unwrap_or(serde_json::Value::Null);
    if req.jsonrpc != "2.0" {
      responses.push(err(id, -32600, "Invalid JSON-RPC version"));
      continue;
    }
    let res = handle_method(&state, &req, id).await;
    responses.push(res);
  }

  if wants_sse {
    let initial = if is_batch {
      serde_json::to_value(&responses).unwrap_or(serde_json::json!([]))
    } else {
      serde_json::to_value(responses.first()).unwrap_or(serde_json::json!(null))
    };

    let rx = state.store.events.subscribe();
    let notif_stream = broadcast_stream(rx).map(|evt| {
      let msg = match evt {
        StoreEvent::Created(item) => jsonrpc_notification("notifications/klaxon", serde_json::json!({"type":"created","item": item})),
        StoreEvent::Updated(item) => jsonrpc_notification("notifications/klaxon", serde_json::json!({"type":"updated","item": item})),
        StoreEvent::Answered { id, response } => jsonrpc_notification(
          "notifications/klaxon",
          serde_json::json!({"type":"answered","id": id.to_string(), "response": response}),
        ),
      };
      Ok::<_, std::convert::Infallible>(sse_message_event(&msg))
    });

    let stream = futures::stream::once(async move {
      Ok::<_, std::convert::Infallible>(sse_message_event(&initial))
    })
    .chain(notif_stream);

    return Sse::new(stream)
      .keep_alive(axum::response::sse::KeepAlive::new().interval(Duration::from_secs(15)).text("ping"))
      .into_response();
  }

  if is_batch {
    return Json(serde_json::to_value(responses).unwrap_or(serde_json::json!([]))).into_response();
  }

  Json(responses.into_iter().next().unwrap_or_else(|| err(serde_json::Value::Null, -32600, "Invalid request")))
    .into_response()
}

async fn handle_method(state: &McpState, req: &JsonRpcRequest, id: serde_json::Value) -> JsonRpcResponse {
  match req.method.as_str() {
    "initialize" => ok(
      id,
      serde_json::json!({
        "protocolVersion": "2025-03-26",
        "capabilities": {"tools": {}, "resources": {}, "prompts": {}},
        "serverInfo": {"name": "klaxon-tauri-proto", "version": "0.2.0"}
      }),
    ),
    "tools/list" => ok(
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
          {"name":"tokens.add","description":"Report token usage delta","inputSchema":{"type":"object","properties":{"model":{"type":"string"},"input_tokens":{"type":"number"},"output_tokens":{"type":"number"},"cost_usd":{"type":"number"},"source":{"type":"string"}},"required":["model","input_tokens","output_tokens"]}}
        ]
      }),
    ),
    "tools/call" => {
      let name = req.params.get("name").and_then(|v| v.as_str()).unwrap_or("");
      let args = req.params.get("arguments").cloned().unwrap_or(serde_json::json!({}));

      match name {
        "klaxon.notify" => match parse_notify_args(&args) {
          Ok((level, title, message, ttl_ms, actions)) => {
            let it = state.store.notify(level, title, message, ttl_ms).await;
            if !actions.is_empty() {
              let _ = state.store.set_actions(it.id, actions).await;
            }
            ok(id, serde_json::json!({"content":[{"type":"text","text":it.id.to_string()}],"id":it.id.to_string()}))
          }
          Err(e) => err(id, -32602, e),
        },
        "klaxon.ask" => match parse_ask_args(&args) {
          Ok((level, title, message, form, ttl_ms)) => {
            let it = state.store.ask(level, title, message, form, ttl_ms).await;
            ok(id, serde_json::json!({"content":[{"type":"text","text":it.id.to_string()}],"id":it.id.to_string()}))
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
          ok(id, serde_json::json!({
            "ok": true,
            "stopped": serde_json::to_value(entries).unwrap_or(serde_json::json!([]))
          }))
        }
        "timer.switch" => {
          let Some(issue) = args.get("issue").and_then(|v| v.as_str()) else {
            return err(id, -32602, "Missing issue");
          };
          let stopped = state.timer.switch(issue.to_string()).await;
          ok(id, serde_json::json!({
            "ok": true,
            "stopped": serde_json::to_value(stopped).unwrap_or(serde_json::json!([]))
          }))
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
          state.tokens.add(TokenDelta { model: model.to_string(), input_tokens, output_tokens, cost_usd, source }).await;
          ok(id, serde_json::json!({"ok": true}))
        }
        _ => err(id, -32601, format!("Unknown tool: {name}")),
      }
    }
    "resources/list" => ok(
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
    ),
    "resources/read" => {
      let Some(uri) = req.params.get("uri").and_then(|v| v.as_str()) else {
        return err(id, -32602, "Missing uri");
      };

      if uri == "klaxon/open" {
        let items = state.store.list_open().await;
        ok(id, serde_json::json!({
          "contents": [{"uri":"klaxon/open","mimeType":"application/json","text": serde_json::to_string(&items).unwrap_or("[]".into())}]
        }))
      } else if let Some(rest) = uri.strip_prefix("klaxon/item/") {
        let Ok(uuid) = uuid::Uuid::parse_str(rest) else {
          return err(id, -32602, "Invalid id");
        };
        let item = state.store.get(uuid).await;
        ok(id, serde_json::json!({
          "contents": [{"uri": uri, "mimeType":"application/json","text": serde_json::to_string(&item).unwrap_or("null".into())}]
        }))
      } else if let Some(rest) = uri.strip_prefix("klaxon/answer/") {
        let Ok(uuid) = uuid::Uuid::parse_str(rest) else {
          return err(id, -32602, "Invalid id");
        };
        let ans = state.store.get_answer(uuid).await;
        ok(id, serde_json::json!({
          "contents": [{"uri": uri, "mimeType":"application/json","text": serde_json::to_string(&ans).unwrap_or("null".into())}]
        }))
      } else if uri == "timer/active" {
        let active: Vec<_> = state.timer.active_state().await
          .into_iter().map(|(issue_id, start)| serde_json::json!({"issue_id": issue_id, "start": start.to_rfc3339()})).collect();
        ok(id, serde_json::json!({
          "contents": [{"uri":"timer/active","mimeType":"application/json","text": serde_json::to_string(&active).unwrap_or("null".into())}]
        }))
      } else if uri == "timer/today" {
        let summary = state.timer.today_summary().await;
        ok(id, serde_json::json!({
          "contents": [{"uri":"timer/today","mimeType":"application/json","text": serde_json::to_string(&summary).unwrap_or("[]".into())}]
        }))
      } else if uri == "tokens/today" {
        let totals = state.tokens.today_totals().await;
        ok(id, serde_json::json!({
          "contents": [{"uri":"tokens/today","mimeType":"application/json","text": serde_json::to_string(&totals).unwrap_or("[]".into())}]
        }))
      } else {
        err(id, -32602, "Unknown uri")
      }
    }
    _ => err(id, -32601, format!("Unknown method: {}", req.method)),
  }
}

fn parse_level(v: &serde_json::Value) -> Result<KlaxonLevel, String> {
  let Some(s) = v.as_str() else { return Err("level must be a string".into()); };
  match s {
    "info" => Ok(KlaxonLevel::Info),
    "warning" => Ok(KlaxonLevel::Warning),
    "error" => Ok(KlaxonLevel::Error),
    "success" => Ok(KlaxonLevel::Success),
    _ => Err("level must be one of info|warning|error|success".into()),
  }
}

fn parse_notify_args(args: &serde_json::Value) -> Result<(KlaxonLevel, String, String, Option<u64>, Vec<KlaxonAction>), String> {
  let level = parse_level(args.get("level").ok_or("Missing level")?)?;
  let title = args.get("title").and_then(|v| v.as_str()).ok_or("Missing title")?.to_string();
  let message = args.get("message").and_then(|v| v.as_str()).ok_or("Missing message")?.to_string();
  let ttl_ms = args.get("ttl_ms").and_then(|v| v.as_u64());
  let actions = args
    .get("actions")
    .and_then(|v| v.as_array())
    .map(|arr| {
      arr.iter().filter_map(|a| serde_json::from_value::<KlaxonAction>(a.clone()).ok()).collect::<Vec<_>>()
    })
    .unwrap_or_default();
  Ok((level, title, message, ttl_ms, actions))
}

fn parse_ask_args(args: &serde_json::Value) -> Result<(KlaxonLevel, String, String, KlaxonForm, Option<u64>), String> {
  let level = parse_level(args.get("level").ok_or("Missing level")?)?;
  let title = args.get("title").and_then(|v| v.as_str()).ok_or("Missing title")?.to_string();
  let message = args.get("message").and_then(|v| v.as_str()).ok_or("Missing message")?.to_string();
  let form_val = args.get("form").ok_or("Missing form")?;
  let form: KlaxonForm = serde_json::from_value(form_val.clone()).map_err(|e| format!("Invalid form: {e}"))?;
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

async fn handle_discover(State(state): State<McpState>) -> impl IntoResponse {
  Json(DiscoverResponse {
    url: "/mcp".to_string(),
    bearer: state.bearer.clone(),
    protocol_version: "2025-03-26",
  })
}

async fn handle_sse(State(state): State<McpState>, headers: HeaderMap) -> Response {
  if !check_auth(&headers, &state.bearer) {
    return unauthorized();
  }

  let rx = state.store.events.subscribe();
  let stream = broadcast_stream(rx).map(|evt| {
    let msg = match evt {
      StoreEvent::Created(item) => jsonrpc_notification("notifications/klaxon", serde_json::json!({"type":"created","item": item})),
      StoreEvent::Updated(item) => jsonrpc_notification("notifications/klaxon", serde_json::json!({"type":"updated","item": item})),
      StoreEvent::Answered { id, response } => jsonrpc_notification(
        "notifications/klaxon",
        serde_json::json!({"type":"answered","id": id.to_string(), "response": response}),
      ),
    };
    Ok::<_, std::convert::Infallible>(sse_message_event(&msg))
  });

  Sse::new(stream)
    .keep_alive(axum::response::sse::KeepAlive::new().interval(Duration::from_secs(15)).text("ping"))
    .into_response()
}

fn jsonrpc_notification(method: &str, params: serde_json::Value) -> serde_json::Value {
  serde_json::json!({"jsonrpc": "2.0", "method": method, "params": params})
}

fn sse_message_event(msg: &serde_json::Value) -> axum::response::sse::Event {
  let json = serde_json::to_string(msg).unwrap_or_else(|_| "{}".into());
  axum::response::sse::Event::default().event("message").data(json)
}

fn broadcast_stream(rx: broadcast::Receiver<StoreEvent>) -> impl Stream<Item = StoreEvent> {
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
