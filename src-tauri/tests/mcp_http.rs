use std::sync::Arc;

use klaxon_tauri_mcp_proto_lib::{
    mcp_http::start_mcp_server, store::KlaxonStore, timer_store::TimerStore,
    token_store::TokenStore,
};

struct TestServer {
    base: String,
    bearer: String,
    store: Arc<KlaxonStore>,
    _dir: tempfile::TempDir,
}

async fn make_server() -> TestServer {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(KlaxonStore::new(dir.path().join("store.json")).await);
    let timer = Arc::new(TimerStore::new(dir.path().join("timer.json")).await);
    let tokens = Arc::new(TokenStore::new(dir.path().join("tokens.json")).await);
    let (addr, bearer) = start_mcp_server(Arc::clone(&store), timer, tokens, 0).await.unwrap();
    TestServer { base: format!("http://{addr}"), bearer, store, _dir: dir }
}

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

async fn rpc(
    base: &str,
    bearer: &str,
    method: &str,
    params: serde_json::Value,
) -> serde_json::Value {
    client()
        .post(format!("{base}/mcp"))
        .bearer_auth(bearer)
        .json(&serde_json::json!({
          "jsonrpc": "2.0",
          "id": 1,
          "method": method,
          "params": params
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
}

#[tokio::test]
async fn health_returns_200() {
    let srv = make_server().await;
    let resp = client().get(format!("{}/health", srv.base)).send().await.unwrap();
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn discover_returns_bearer() {
    let srv = make_server().await;
    let resp: serde_json::Value = client()
        .get(format!("{}/mcp/discover", srv.base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(resp["bearer"], srv.bearer);
    assert_eq!(resp["protocol_version"], "2025-03-26");
}

#[tokio::test]
async fn unauthorized_without_bearer() {
    let srv = make_server().await;
    let resp = client()
        .post(format!("{}/mcp", srv.base))
        .json(&serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn initialize_method() {
    let srv = make_server().await;
    let resp = rpc(&srv.base, &srv.bearer, "initialize", serde_json::json!({})).await;
    assert_eq!(resp["result"]["protocolVersion"], "2025-03-26");
}

#[tokio::test]
async fn tools_list() {
    let srv = make_server().await;
    let resp = rpc(&srv.base, &srv.bearer, "tools/list", serde_json::json!({})).await;
    let tools = resp["result"]["tools"].as_array().unwrap();
    let names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
    assert!(names.contains(&"klaxon.notify"));
    assert!(names.contains(&"klaxon.ask"));
    assert!(names.contains(&"klaxon.ack"));
    assert!(names.contains(&"klaxon.dismiss"));
}

#[tokio::test]
async fn notify_then_ack() {
    let srv = make_server().await;

    // Create a notification
    let notify_resp = rpc(
        &srv.base,
        &srv.bearer,
        "tools/call",
        serde_json::json!({
          "name": "klaxon.notify",
          "arguments": {"level": "info", "title": "Hello", "message": "World"}
        }),
    )
    .await;
    let item_id = notify_resp["result"]["id"].as_str().unwrap().to_string();

    // Verify it's open
    let open_resp =
        rpc(&srv.base, &srv.bearer, "resources/read", serde_json::json!({"uri": "klaxon/open"}))
            .await;
    let open_text = open_resp["result"]["contents"][0]["text"].as_str().unwrap();
    let open_items: Vec<serde_json::Value> = serde_json::from_str(open_text).unwrap();
    assert!(open_items.iter().any(|it| it["id"].as_str() == Some(&item_id)));

    // Acknowledge it
    rpc(
        &srv.base,
        &srv.bearer,
        "tools/call",
        serde_json::json!({
          "name": "klaxon.ack",
          "arguments": {"id": item_id}
        }),
    )
    .await;

    // Verify it's gone from open list
    let open_resp2 =
        rpc(&srv.base, &srv.bearer, "resources/read", serde_json::json!({"uri": "klaxon/open"}))
            .await;
    let open_text2 = open_resp2["result"]["contents"][0]["text"].as_str().unwrap();
    let open_items2: Vec<serde_json::Value> = serde_json::from_str(open_text2).unwrap();
    assert!(!open_items2.iter().any(|it| it["id"].as_str() == Some(&item_id)));
}

#[tokio::test]
async fn ask_then_answer_via_store() {
    let srv = make_server().await;

    // Create a question
    let ask_resp = rpc(
        &srv.base,
        &srv.bearer,
        "tools/call",
        serde_json::json!({
          "name": "klaxon.ask",
          "arguments": {
            "level": "info",
            "title": "Confirm?",
            "message": "Please confirm",
            "form": {
              "id": "confirm",
              "title": "Confirm",
              "description": "",
              "fields": []
            }
          }
        }),
    )
    .await;
    let item_id_str = ask_resp["result"]["id"].as_str().unwrap().to_string();
    let item_id = uuid::Uuid::parse_str(&item_id_str).unwrap();

    // Answer directly via store
    let answer = serde_json::json!({"confirmed": true});
    srv.store.answer(item_id, answer.clone()).await.unwrap();

    // Read the answer via HTTP
    let ans_resp = rpc(
        &srv.base,
        &srv.bearer,
        "resources/read",
        serde_json::json!({"uri": format!("klaxon/answer/{item_id_str}")}),
    )
    .await;
    let ans_text = ans_resp["result"]["contents"][0]["text"].as_str().unwrap();
    let ans_val: serde_json::Value = serde_json::from_str(ans_text).unwrap();
    assert_eq!(ans_val, answer);
}
