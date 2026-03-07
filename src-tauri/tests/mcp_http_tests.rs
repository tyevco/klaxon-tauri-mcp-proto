use std::sync::Arc;

use klaxon_tauri_mcp_proto_lib::{
    mcp_http::start_mcp_server,
    store::KlaxonStore,
    timer_store::TimerStore,
    token_store::TokenStore,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn spawn_server() -> (String, String, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = Arc::new(KlaxonStore::new(dir.path().join("klaxon.json")).await);
    let timer = Arc::new(TimerStore::new(dir.path().join("timer.json")).await);
    let tokens = Arc::new(TokenStore::new(dir.path().join("tokens.json")).await);
    let (addr, bearer) = start_mcp_server(store, timer, tokens, 0).await.expect("start server");
    (format!("http://{}", addr), bearer, dir)
}

async fn rpc(
    client: &reqwest::Client,
    base_url: &str,
    bearer: &str,
    method: &str,
    params: serde_json::Value,
) -> serde_json::Value {
    client
        .post(format!("{}/mcp", base_url))
        .header("Authorization", format!("Bearer {}", bearer))
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        }))
        .send()
        .await
        .expect("send")
        .json()
        .await
        .expect("json")
}

fn result_of(resp: serde_json::Value) -> serde_json::Value {
    assert!(
        resp.get("error").is_none() || resp["error"].is_null(),
        "Expected no error, got: {:?}",
        resp
    );
    resp["result"].clone()
}

async fn read_resource(
    client: &reqwest::Client,
    base_url: &str,
    bearer: &str,
    uri: &str,
) -> serde_json::Value {
    let resp = rpc(client, base_url, bearer, "resources/read", serde_json::json!({ "uri": uri })).await;
    let result = result_of(resp);
    let text = result["contents"][0]["text"].as_str().expect("text field");
    serde_json::from_str(text).expect("parse resource text as json")
}

fn call(name: &str, args: serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "name": name, "arguments": args })
}

// ---------------------------------------------------------------------------
// Infrastructure / auth
// ---------------------------------------------------------------------------

#[tokio::test]
async fn health_endpoint() {
    let (base_url, _bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = client.get(format!("{}/health", base_url)).send().await.expect("get");
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text().await.unwrap(), "ok");
}

#[tokio::test]
async fn discover_no_auth() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let body: serde_json::Value = client
        .get(format!("{}/mcp/discover", base_url))
        .send()
        .await
        .expect("get")
        .json()
        .await
        .expect("json");
    assert_eq!(body["bearer"].as_str().unwrap(), bearer);
    assert_eq!(body["protocol_version"].as_str().unwrap(), "2025-03-26");
}

#[tokio::test]
async fn post_rejects_missing_auth() {
    let (base_url, _bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let status = client
        .post(format!("{}/mcp", base_url))
        .json(&serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }))
        .send()
        .await
        .expect("send")
        .status();
    assert_eq!(status, 401);
}

#[tokio::test]
async fn post_rejects_wrong_bearer() {
    let (base_url, _bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let status = client
        .post(format!("{}/mcp", base_url))
        .header("Authorization", "Bearer wrong_token")
        .json(&serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }))
        .send()
        .await
        .expect("send")
        .status();
    assert_eq!(status, 401);
}

#[tokio::test]
async fn initialize() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(&client, &base_url, &bearer, "initialize", serde_json::json!({})).await;
    let result = result_of(resp);
    assert_eq!(result["protocolVersion"].as_str().unwrap(), "2025-03-26");
    assert_eq!(result["serverInfo"]["name"].as_str().unwrap(), "klaxon-tauri-proto");
}

#[tokio::test]
async fn tools_list() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(&client, &base_url, &bearer, "tools/list", serde_json::json!({})).await;
    let result = result_of(resp);
    let tools = result["tools"].as_array().expect("tools array");
    assert_eq!(tools.len(), 8);
    let names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
    assert!(names.contains(&"klaxon.notify"));
    assert!(names.contains(&"klaxon.ask"));
    assert!(names.contains(&"klaxon.ack"));
    assert!(names.contains(&"klaxon.dismiss"));
    assert!(names.contains(&"timer.start"));
    assert!(names.contains(&"timer.stop"));
    assert!(names.contains(&"timer.switch"));
    assert!(names.contains(&"tokens.add"));
}

#[tokio::test]
async fn resources_list() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(&client, &base_url, &bearer, "resources/list", serde_json::json!({})).await;
    let result = result_of(resp);
    let resources = result["resources"].as_array().expect("resources array");
    let uris: Vec<&str> = resources.iter().filter_map(|r| r["uri"].as_str()).collect();
    assert!(uris.contains(&"klaxon/open"));
    assert!(uris.contains(&"klaxon/item/{id}"));
    assert!(uris.contains(&"klaxon/answer/{id}"));
    assert!(uris.contains(&"timer/active"));
    assert!(uris.contains(&"timer/today"));
    assert!(uris.contains(&"tokens/today"));
}

#[tokio::test]
async fn unknown_method() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(&client, &base_url, &bearer, "does/not/exist", serde_json::json!({})).await;
    assert_eq!(resp["error"]["code"].as_i64().unwrap(), -32601);
}

// ---------------------------------------------------------------------------
// klaxon.notify
// ---------------------------------------------------------------------------

#[tokio::test]
async fn notify_creates_item_in_open() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.notify", serde_json::json!({ "level": "warning", "title": "Hey", "message": "Hello" })),
    ).await;
    result_of(resp);

    let items = read_resource(&client, &base_url, &bearer, "klaxon/open").await;
    let arr = items.as_array().expect("array");
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["title"].as_str().unwrap(), "Hey");
    assert_eq!(arr[0]["level"].as_str().unwrap(), "warning");
    assert_eq!(arr[0]["status"].as_str().unwrap(), "open");
}

#[tokio::test]
async fn notify_missing_message() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.notify", serde_json::json!({ "level": "info", "title": "Hi" })),
    ).await;
    assert_eq!(resp["error"]["code"].as_i64().unwrap(), -32602);
}

#[tokio::test]
async fn notify_invalid_level() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.notify", serde_json::json!({ "level": "critical", "title": "Hi", "message": "x" })),
    ).await;
    assert_eq!(resp["error"]["code"].as_i64().unwrap(), -32602);
}

#[tokio::test]
async fn notify_ttl_expires_on_read() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.notify", serde_json::json!({ "level": "info", "title": "Expires", "message": "x", "ttl_ms": 1 })),
    ).await;

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    let items = read_resource(&client, &base_url, &bearer, "klaxon/open").await;
    assert_eq!(items.as_array().expect("array").len(), 0);
}

#[tokio::test]
async fn notify_item_resource_by_id() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.notify", serde_json::json!({ "level": "success", "title": "Done", "message": "yes" })),
    ).await;
    let result = result_of(resp);
    let id = result["id"].as_str().expect("id in result");

    let item = read_resource(&client, &base_url, &bearer, &format!("klaxon/item/{}", id)).await;
    assert_eq!(item["title"].as_str().unwrap(), "Done");
}

// ---------------------------------------------------------------------------
// klaxon.ack / klaxon.dismiss
// ---------------------------------------------------------------------------

#[tokio::test]
async fn ack_removes_non_form_item() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.notify", serde_json::json!({ "level": "info", "title": "T", "message": "m" })),
    ).await;
    let id = result_of(resp)["id"].as_str().unwrap().to_string();

    rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.ack", serde_json::json!({ "id": id })),
    ).await;

    let items = read_resource(&client, &base_url, &bearer, "klaxon/open").await;
    assert_eq!(items.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn ack_missing_id_param() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.ack", serde_json::json!({})),
    ).await;
    assert_eq!(resp["error"]["code"].as_i64().unwrap(), -32602);
}

#[tokio::test]
async fn ack_invalid_uuid() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.ack", serde_json::json!({ "id": "not-a-uuid" })),
    ).await;
    assert_eq!(resp["error"]["code"].as_i64().unwrap(), -32602);
}

#[tokio::test]
async fn dismiss_removes_item() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.notify", serde_json::json!({ "level": "info", "title": "T", "message": "m" })),
    ).await;
    let id = result_of(resp)["id"].as_str().unwrap().to_string();

    rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.dismiss", serde_json::json!({ "id": id })),
    ).await;

    let items = read_resource(&client, &base_url, &bearer, "klaxon/open").await;
    assert_eq!(items.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn ack_form_item_stays_open() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.ask", serde_json::json!({
            "level": "info",
            "title": "Q",
            "message": "?",
            "form": {
                "id": "f1",
                "title": "Form",
                "fields": [{ "type": "text", "id": "ans", "label": "Answer" }]
            }
        })),
    ).await;
    let id = result_of(resp)["id"].as_str().unwrap().to_string();

    rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.ack", serde_json::json!({ "id": id })),
    ).await;

    let items = read_resource(&client, &base_url, &bearer, "klaxon/open").await;
    assert_eq!(items.as_array().unwrap().len(), 1, "form item should remain open after ack");
}

// ---------------------------------------------------------------------------
// klaxon.ask
// ---------------------------------------------------------------------------

#[tokio::test]
async fn ask_creates_item_with_form() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.ask", serde_json::json!({
            "level": "info",
            "title": "Q",
            "message": "Please answer",
            "form": {
                "id": "f1",
                "title": "Survey",
                "fields": [{ "type": "text", "id": "name", "label": "Name" }]
            }
        })),
    ).await;

    let items = read_resource(&client, &base_url, &bearer, "klaxon/open").await;
    let arr = items.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert!(!arr[0]["form"].is_null(), "form should not be null");
    assert_eq!(arr[0]["form"]["fields"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn ask_missing_form() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.ask", serde_json::json!({ "level": "info", "title": "Q", "message": "?" })),
    ).await;
    assert_eq!(resp["error"]["code"].as_i64().unwrap(), -32602);
}

#[tokio::test]
async fn answer_resource_null_before_answer() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("klaxon.ask", serde_json::json!({
            "level": "info",
            "title": "Q",
            "message": "?",
            "form": { "id": "f1", "title": "F", "fields": [] }
        })),
    ).await;
    let id = result_of(resp)["id"].as_str().unwrap().to_string();

    let answer = read_resource(&client, &base_url, &bearer, &format!("klaxon/answer/{}", id)).await;
    assert!(answer.is_null(), "answer should be null before any answer is submitted");
}

// ---------------------------------------------------------------------------
// timer
// ---------------------------------------------------------------------------

#[tokio::test]
async fn timer_start_and_active_resource() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("timer.start", serde_json::json!({ "issue": "PROJ-1" })),
    ).await;
    result_of(resp);

    let active = read_resource(&client, &base_url, &bearer, "timer/active").await;
    assert_eq!(active["issue_id"].as_str().unwrap(), "PROJ-1");
}

#[tokio::test]
async fn timer_double_start_error() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    rpc(
        &client, &base_url, &bearer, "tools/call",
        call("timer.start", serde_json::json!({ "issue": "PROJ-1" })),
    ).await;
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("timer.start", serde_json::json!({ "issue": "PROJ-1" })),
    ).await;
    assert_eq!(resp["error"]["code"].as_i64().unwrap(), -32602);
}

#[tokio::test]
async fn timer_stop_clears_active() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    rpc(
        &client, &base_url, &bearer, "tools/call",
        call("timer.start", serde_json::json!({ "issue": "PROJ-1" })),
    ).await;
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("timer.stop", serde_json::json!({})),
    ).await;
    let result = result_of(resp);
    assert_eq!(result["ok"].as_bool().unwrap(), true);
    assert_eq!(result["entry"]["issue_id"].as_str().unwrap(), "PROJ-1");
    assert!(result["entry"]["seconds"].as_u64().is_some());

    let active = read_resource(&client, &base_url, &bearer, "timer/active").await;
    assert!(active.is_null(), "active should be null after stop");
}

#[tokio::test]
async fn timer_today_summary() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();

    rpc(&client, &base_url, &bearer, "tools/call", call("timer.start", serde_json::json!({ "issue": "PROJ-1" }))).await;
    rpc(&client, &base_url, &bearer, "tools/call", call("timer.stop", serde_json::json!({}))).await;
    rpc(&client, &base_url, &bearer, "tools/call", call("timer.start", serde_json::json!({ "issue": "PROJ-2" }))).await;
    rpc(&client, &base_url, &bearer, "tools/call", call("timer.stop", serde_json::json!({}))).await;

    let summary = read_resource(&client, &base_url, &bearer, "timer/today").await;
    let arr = summary.as_array().unwrap();
    let ids: Vec<&str> = arr.iter().filter_map(|e| e["issue_id"].as_str()).collect();
    assert!(ids.contains(&"PROJ-1"));
    assert!(ids.contains(&"PROJ-2"));
}

#[tokio::test]
async fn timer_switch() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    rpc(
        &client, &base_url, &bearer, "tools/call",
        call("timer.start", serde_json::json!({ "issue": "PROJ-1" })),
    ).await;
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("timer.switch", serde_json::json!({ "issue": "PROJ-2" })),
    ).await;
    let result = result_of(resp);
    assert_eq!(result["stopped"]["issue_id"].as_str().unwrap(), "PROJ-1");

    let active = read_resource(&client, &base_url, &bearer, "timer/active").await;
    assert_eq!(active["issue_id"].as_str().unwrap(), "PROJ-2");
}

#[tokio::test]
async fn timer_stop_no_active() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("timer.stop", serde_json::json!({})),
    ).await;
    let result = result_of(resp);
    assert_eq!(result["ok"].as_bool().unwrap(), true);
    assert!(result["entry"].is_null());
}

#[tokio::test]
async fn timer_start_missing_issue() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("timer.start", serde_json::json!({})),
    ).await;
    assert_eq!(resp["error"]["code"].as_i64().unwrap(), -32602);
}

// ---------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------

#[tokio::test]
async fn tokens_add_and_read() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    rpc(
        &client, &base_url, &bearer, "tools/call",
        call("tokens.add", serde_json::json!({
            "model": "claude-sonnet-4-6",
            "input_tokens": 100,
            "output_tokens": 50
        })),
    ).await;

    let totals = read_resource(&client, &base_url, &bearer, "tokens/today").await;
    let arr = totals.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["model"].as_str().unwrap(), "claude-sonnet-4-6");
    assert_eq!(arr[0]["input_tokens"].as_u64().unwrap(), 100);
    assert_eq!(arr[0]["output_tokens"].as_u64().unwrap(), 50);
}

#[tokio::test]
async fn tokens_accumulate() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    rpc(
        &client, &base_url, &bearer, "tools/call",
        call("tokens.add", serde_json::json!({ "model": "m", "input_tokens": 100, "output_tokens": 40 })),
    ).await;
    rpc(
        &client, &base_url, &bearer, "tools/call",
        call("tokens.add", serde_json::json!({ "model": "m", "input_tokens": 50, "output_tokens": 20 })),
    ).await;

    let totals = read_resource(&client, &base_url, &bearer, "tokens/today").await;
    let arr = totals.as_array().unwrap();
    assert_eq!(arr[0]["input_tokens"].as_u64().unwrap(), 150);
    assert_eq!(arr[0]["output_tokens"].as_u64().unwrap(), 60);
}

#[tokio::test]
async fn tokens_missing_model() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "tools/call",
        call("tokens.add", serde_json::json!({ "input_tokens": 10, "output_tokens": 5 })),
    ).await;
    assert_eq!(resp["error"]["code"].as_i64().unwrap(), -32602);
}

#[tokio::test]
async fn tokens_multiple_models() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    rpc(
        &client, &base_url, &bearer, "tools/call",
        call("tokens.add", serde_json::json!({ "model": "model-a", "input_tokens": 10, "output_tokens": 5 })),
    ).await;
    rpc(
        &client, &base_url, &bearer, "tools/call",
        call("tokens.add", serde_json::json!({ "model": "model-b", "input_tokens": 20, "output_tokens": 8 })),
    ).await;

    let totals = read_resource(&client, &base_url, &bearer, "tokens/today").await;
    assert_eq!(totals.as_array().unwrap().len(), 2);
}

// ---------------------------------------------------------------------------
// Protocol / batch
// ---------------------------------------------------------------------------

#[tokio::test]
async fn batch_jsonrpc() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let responses: serde_json::Value = client
        .post(format!("{}/mcp", base_url))
        .header("Authorization", format!("Bearer {}", bearer))
        .json(&serde_json::json!([
            { "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} },
            { "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }
        ]))
        .send()
        .await
        .expect("send")
        .json()
        .await
        .expect("json");

    let arr = responses.as_array().expect("batch response is array");
    assert_eq!(arr.len(), 2);
    let ids: Vec<i64> = arr.iter().filter_map(|r| r["id"].as_i64()).collect();
    assert!(ids.contains(&1));
    assert!(ids.contains(&2));
}

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

#[tokio::test]
async fn unknown_resource_uri() {
    let (base_url, bearer, _dir) = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = rpc(
        &client, &base_url, &bearer, "resources/read",
        serde_json::json!({ "uri": "no/such/resource" }),
    ).await;
    assert_eq!(resp["error"]["code"].as_i64().unwrap(), -32602);
}
