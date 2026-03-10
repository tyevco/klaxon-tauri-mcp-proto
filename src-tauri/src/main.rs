#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod alert_store;
mod checkpoint_store;
mod logtail_store;
mod mcp_http;
mod models;
mod queue_store;
mod scratchpad_store;
mod settings_store;
mod store;
mod timer_store;
mod token_store;
mod toollog_store;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::{
    alert_store::{AlertEvent, AlertStore},
    checkpoint_store::{CheckpointEvent, CheckpointStore},
    logtail_store::{LogTailEvent, LogTailStore},
    mcp_http::{start_mcp_server, AgentInfo},
    models::{KlaxonLevel, KlaxonStatus},
    queue_store::{QueueEvent, QueueStore},
    scratchpad_store::{ScratchpadEvent, ScratchpadStore},
    settings_store::{AppSettings, SettingsStore},
    store::{KlaxonStore, StoreEvent},
    timer_store::{TimerEvent, TimerStore},
    token_store::{TokenDelta, TokenEvent, TokenStore},
    toollog_store::{ToolLogEvent, ToolLogStore},
};

#[derive(Debug, Clone, serde::Serialize)]
struct McpStatus {
    url: String,
    bearer: String,
}

// ─── Klaxon commands ──────────────────────────────────────────────────────────

#[tauri::command]
async fn klaxon_list_open(
    state: tauri::State<'_, Arc<KlaxonStore>>,
) -> Result<Vec<crate::models::KlaxonItem>, String> {
    Ok(state.list_open().await)
}

#[tauri::command]
async fn klaxon_ack(state: tauri::State<'_, Arc<KlaxonStore>>, id: String) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|_| "invalid id".to_string())?;
    state.ack(uuid).await;
    Ok(())
}

#[tauri::command]
async fn klaxon_dismiss(
    state: tauri::State<'_, Arc<KlaxonStore>>,
    id: String,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|_| "invalid id".to_string())?;
    state.dismiss(uuid).await;
    Ok(())
}

#[derive(serde::Serialize)]
struct KlaxonRunActionResult {
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    arguments: Option<serde_json::Value>,
}

#[tauri::command]
async fn klaxon_run_action(
    state: tauri::State<'_, Arc<KlaxonStore>>,
    id: String,
    action_id: String,
) -> Result<KlaxonRunActionResult, String> {
    let uuid = Uuid::parse_str(&id).map_err(|_| "invalid id".to_string())?;
    let item = state.get_item(uuid).await.ok_or_else(|| "not found".to_string())?;
    let action = item
        .actions
        .into_iter()
        .find(|a| match a {
            crate::models::KlaxonAction::Ack { id, .. } => id == &action_id,
            crate::models::KlaxonAction::OpenUrl { id, .. } => id == &action_id,
            crate::models::KlaxonAction::RunTool { id, .. } => id == &action_id,
        })
        .ok_or_else(|| "action not found".to_string())?;

    match action {
        crate::models::KlaxonAction::Ack { .. } => {
            state.ack(uuid).await;
            Ok(KlaxonRunActionResult { kind: "ack".into(), url: None, tool: None, arguments: None })
        }
        crate::models::KlaxonAction::OpenUrl { url, .. } => Ok(KlaxonRunActionResult {
            kind: "open_url".into(),
            url: Some(url),
            tool: None,
            arguments: None,
        }),
        crate::models::KlaxonAction::RunTool { tool, arguments, .. } => Ok(KlaxonRunActionResult {
            kind: "run_tool".into(),
            url: None,
            tool: Some(tool),
            arguments: Some(arguments),
        }),
    }
}

#[tauri::command]
async fn klaxon_answer(
    state: tauri::State<'_, Arc<KlaxonStore>>,
    id: String,
    response: serde_json::Value,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|_| "invalid id".to_string())?;
    state.answer(uuid, response).await;
    Ok(())
}

#[tauri::command]
async fn klaxon_get_item(
    state: tauri::State<'_, Arc<KlaxonStore>>,
    id: String,
) -> Result<Option<crate::models::KlaxonItem>, String> {
    let uuid = Uuid::parse_str(&id).map_err(|_| "invalid id".to_string())?;
    Ok(state.get_item(uuid).await)
}

#[tauri::command]
fn klaxon_open_form(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let win = app.get_webview_window("form").ok_or_else(|| "form window not found".to_string())?;
    win.show().map_err(|e| e.to_string())?;
    let _ = win.set_focus(); // focus can fail on Windows due to focus-lock rules; ignore
    win.emit("form.open", &serde_json::json!({ "id": id })).map_err(|e| e.to_string())
}

#[tauri::command]
async fn klaxon_list_all(
    state: tauri::State<'_, Arc<KlaxonStore>>,
    limit: i64,
    offset: i64,
) -> Result<Vec<crate::models::KlaxonItem>, String> {
    Ok(state.list_all(limit, offset).await)
}

#[tauri::command]
async fn klaxon_list_answered(
    state: tauri::State<'_, Arc<KlaxonStore>>,
    limit: i64,
) -> Result<Vec<crate::models::KlaxonItem>, String> {
    Ok(state.list_answered(limit).await)
}

// ─── Timer commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn timer_start(
    state: tauri::State<'_, Arc<TimerStore>>,
    issue_id: String,
) -> Result<(), String> {
    state.start(issue_id).await
}

#[tauri::command]
async fn timer_stop(
    state: tauri::State<'_, Arc<TimerStore>>,
    issue_id: String,
) -> Result<(), String> {
    state.stop(&issue_id).await;
    Ok(())
}

#[tauri::command]
async fn timer_switch(
    state: tauri::State<'_, Arc<TimerStore>>,
    issue_id: String,
) -> Result<(), String> {
    state.switch(issue_id).await;
    Ok(())
}

#[tauri::command]
async fn timer_today(
    state: tauri::State<'_, Arc<TimerStore>>,
) -> Result<Vec<crate::timer_store::IssueSummary>, String> {
    Ok(state.today_summary().await)
}

#[tauri::command]
async fn timer_active(
    state: tauri::State<'_, Arc<TimerStore>>,
) -> Result<Vec<serde_json::Value>, String> {
    let v = state.active_state().await
    .into_iter()
    .map(|(issue_id, start)| serde_json::json!({ "issue_id": issue_id, "start": start.to_rfc3339() }))
    .collect();
    Ok(v)
}

#[tauri::command]
async fn timer_week(
    state: tauri::State<'_, Arc<TimerStore>>,
) -> Result<Vec<crate::timer_store::WeekEntry>, String> {
    Ok(state.week_summary().await)
}

// ─── Token commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn tokens_today(
    state: tauri::State<'_, Arc<TokenStore>>,
) -> Result<Vec<crate::token_store::ModelTotals>, String> {
    Ok(state.today_totals().await)
}

#[tauri::command]
async fn tokens_add(
    state: tauri::State<'_, Arc<TokenStore>>,
    delta: TokenDelta,
) -> Result<(), String> {
    state.add(delta).await;
    Ok(())
}

#[tauri::command]
async fn tokens_week(
    state: tauri::State<'_, Arc<TokenStore>>,
) -> Result<Vec<crate::token_store::DayTotals>, String> {
    Ok(state.week_totals().await)
}

#[tauri::command]
async fn tokens_by_source(
    state: tauri::State<'_, Arc<TokenStore>>,
    days: i64,
) -> Result<Vec<crate::token_store::SourceModelTotals>, String> {
    Ok(state.by_source(days).await)
}

// ─── Settings commands ────────────────────────────────────────────────────────

#[tauri::command]
async fn settings_get(state: tauri::State<'_, Arc<SettingsStore>>) -> Result<AppSettings, String> {
    Ok(state.get().await)
}

#[tauri::command]
async fn settings_set(
    state: tauri::State<'_, Arc<SettingsStore>>,
    app: tauri::AppHandle,
    settings: AppSettings,
) -> Result<(), String> {
    state.set(&settings).await;
    let _ = app.emit("settings.changed", &settings);
    Ok(())
}

// ─── MCP status commands ──────────────────────────────────────────────────────

#[tauri::command]
async fn mcp_list_agents(
    state: tauri::State<'_, Arc<tokio::sync::Mutex<std::collections::HashMap<String, AgentInfo>>>>,
) -> Result<Vec<AgentInfo>, String> {
    let map = state.lock().await;
    Ok(map.values().cloned().collect())
}

#[tauri::command]
async fn mcp_get_status(
    state: tauri::State<'_, Arc<Mutex<Option<McpStatus>>>>,
) -> Result<Option<McpStatus>, String> {
    Ok(state.lock().await.clone())
}

// ─── Scratchpad commands ──────────────────────────────────────────────────────

#[tauri::command]
async fn scratchpad_list(
    state: tauri::State<'_, Arc<ScratchpadStore>>,
    limit: i64,
) -> Result<Vec<crate::scratchpad_store::ScratchpadEntry>, String> {
    Ok(state.list(limit).await)
}

#[tauri::command]
async fn scratchpad_add(
    state: tauri::State<'_, Arc<ScratchpadStore>>,
    content: String,
) -> Result<crate::scratchpad_store::ScratchpadEntry, String> {
    Ok(state.add(content, "user".to_string()).await)
}

#[tauri::command]
async fn scratchpad_clear(state: tauri::State<'_, Arc<ScratchpadStore>>) -> Result<(), String> {
    state.clear().await;
    Ok(())
}

// ─── Checkpoint commands ──────────────────────────────────────────────────────

#[tauri::command]
async fn checkpoints_list(
    state: tauri::State<'_, Arc<CheckpointStore>>,
    limit: i64,
) -> Result<Vec<crate::checkpoint_store::Checkpoint>, String> {
    Ok(state.list(limit).await)
}

#[tauri::command]
async fn checkpoints_clear(
    state: tauri::State<'_, Arc<CheckpointStore>>,
    session_tag: Option<String>,
) -> Result<(), String> {
    state.clear(session_tag).await;
    Ok(())
}

// ─── Log tail commands ────────────────────────────────────────────────────────

#[tauri::command]
async fn logtail_recent(
    state: tauri::State<'_, Arc<LogTailStore>>,
    n: usize,
    stream: Option<String>,
) -> Result<Vec<crate::logtail_store::LogLine>, String> {
    Ok(state.recent(n, stream).await)
}

#[tauri::command]
async fn logtail_clear(state: tauri::State<'_, Arc<LogTailStore>>) -> Result<(), String> {
    state.clear().await;
    Ok(())
}

// ─── Tool log commands ────────────────────────────────────────────────────────

#[tauri::command]
async fn toollog_recent(
    state: tauri::State<'_, Arc<ToolLogStore>>,
    n: usize,
) -> Result<Vec<crate::toollog_store::ToolCallEntry>, String> {
    Ok(state.recent(n).await)
}

#[tauri::command]
async fn toollog_clear(state: tauri::State<'_, Arc<ToolLogStore>>) -> Result<(), String> {
    state.clear().await;
    Ok(())
}

// ─── Alert commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn alerts_list(
    state: tauri::State<'_, Arc<AlertStore>>,
) -> Result<Vec<crate::alert_store::AlertRule>, String> {
    Ok(state.list().await)
}

#[tauri::command]
async fn alerts_create(
    state: tauri::State<'_, Arc<AlertStore>>,
    kind: String,
    threshold: f64,
    level: String,
    message: String,
) -> Result<crate::alert_store::AlertRule, String> {
    Ok(state.create(kind, threshold, level, message).await)
}

#[tauri::command]
async fn alerts_update(
    state: tauri::State<'_, Arc<AlertStore>>,
    id: i64,
    kind: String,
    threshold: f64,
    level: String,
    message: String,
    enabled: bool,
) -> Result<(), String> {
    state.update(id, kind, threshold, level, message, enabled).await;
    Ok(())
}

#[tauri::command]
async fn alerts_delete(state: tauri::State<'_, Arc<AlertStore>>, id: i64) -> Result<(), String> {
    state.delete(id).await;
    Ok(())
}

// ─── Queue commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn queue_list(
    state: tauri::State<'_, Arc<QueueStore>>,
) -> Result<Vec<crate::queue_store::WorkItem>, String> {
    Ok(state.list().await)
}

#[tauri::command]
async fn queue_update(
    state: tauri::State<'_, Arc<QueueStore>>,
    id: i64,
    status: String,
) -> Result<(), String> {
    state.update_status(id, status, None).await;
    Ok(())
}

#[tauri::command]
async fn queue_cancel_pending(state: tauri::State<'_, Arc<QueueStore>>) -> Result<(), String> {
    state.cancel_pending().await;
    Ok(())
}

// ─── Session summary ──────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct SessionSummary {
    open_count: usize,
    active_timers: Vec<serde_json::Value>,
    today_cost: f64,
    last_decision: Option<String>,
}

#[tauri::command]
async fn session_summary(
    store: tauri::State<'_, Arc<KlaxonStore>>,
    timer: tauri::State<'_, Arc<TimerStore>>,
    tokens: tauri::State<'_, Arc<TokenStore>>,
) -> Result<SessionSummary, String> {
    let open = store.list_open().await;
    let active = timer.active_state().await
    .into_iter()
    .map(|(issue_id, start)| serde_json::json!({ "issue_id": issue_id, "start": start.to_rfc3339() }))
    .collect();
    let token_totals = tokens.today_totals().await;
    let today_cost: f64 = token_totals.iter().map(|t| t.cost_usd).sum();
    let last_decision = store
        .list_answered(1)
        .await
        .into_iter()
        .next()
        .and_then(|it| it.answered_at)
        .map(|dt| dt.to_rfc3339());
    Ok(SessionSummary { open_count: open.len(), active_timers: active, today_cost, last_decision })
}

#[tauri::command]
async fn session_end(
    store: tauri::State<'_, Arc<KlaxonStore>>,
    timer: tauri::State<'_, Arc<TimerStore>>,
) -> Result<(), String> {
    timer.stop_all().await;
    let items = store.list_open().await;
    for item in items {
        store.dismiss(item.id).await;
    }
    Ok(())
}

// ─── Demo seed ────────────────────────────────────────────────────────────────

async fn demo_seed_inner(
    store: Arc<KlaxonStore>,
    timer: Arc<TimerStore>,
    tokens: Arc<TokenStore>,
    scratchpad: Arc<ScratchpadStore>,
    checkpoints: Arc<CheckpointStore>,
    logtail: Arc<LogTailStore>,
    queue: Arc<QueueStore>,
) {
    use crate::models::{FormField, KlaxonAction, KlaxonForm, KlaxonLevel};

    let item = store
        .notify(
            KlaxonLevel::Info,
            "Agent Status".into(),
            "3 tasks completed, 1 in progress. Running `code-review` on PR #142.".into(),
            None,
        )
        .await;
    store
        .set_actions(
            item.id,
            vec![
                KlaxonAction::RunTool {
                    id: "run".into(),
                    label: "View Task".into(),
                    tool: "task.view".into(),
                    arguments: serde_json::json!({"id": "pr-142"}),
                },
                KlaxonAction::Ack { id: "ack".into(), label: "Got it".into() },
            ],
        )
        .await;

    store
        .notify(
            KlaxonLevel::Warning,
            "Context Window at 87%".into(),
            "Consider summarising or starting a new session before the limit is reached.".into(),
            Some(120_000),
        )
        .await;

    let item = store.notify(
    KlaxonLevel::Error,
    "Build Failed".into(),
    "TypeScript error in src/api.ts:\n  Type 'string' is not assignable to 'number' (line 42)".into(),
    None,
  ).await;
    store
        .set_actions(
            item.id,
            vec![
                KlaxonAction::OpenUrl {
                    id: "logs".into(),
                    label: "View Logs".into(),
                    url: "https://example.com/build-logs".into(),
                },
                KlaxonAction::Ack { id: "ack".into(), label: "Dismiss".into() },
            ],
        )
        .await;

    store
        .ask(
            KlaxonLevel::Info,
            "Approve Code Change".into(),
            "The agent wants to modify src/auth/session.ts".into(),
            KlaxonForm {
                id: "demo-diff".into(),
                title: "Review Change".into(),
                description: "Approve or reject the proposed diff.".into(),
                fields: vec![FormField::DiffApproval {
                    id: "decision".into(),
                    label: "Proposed change".into(),
                    diff: "+ const SESSION_TTL = 86400;\n- const SESSION_TTL = 3600;".into(),
                    approve_label: "Approve".into(),
                    reject_label: "Reject".into(),
                    required: true,
                }],
                pages: vec![],
                submit_label: Some("Submit".into()),
                cancel_label: Some("Cancel".into()),
            },
            None,
        )
        .await;

    timer.seed_demo().await;

    tokens
        .add(TokenDelta {
            model: "claude-opus-4-6".into(),
            input_tokens: 12_840,
            output_tokens: 2_460,
            cost_usd: Some(1.89),
            source: Some("code-review".into()),
        })
        .await;
    tokens
        .add(TokenDelta {
            model: "claude-sonnet-4-6".into(),
            input_tokens: 52_300,
            output_tokens: 11_200,
            cost_usd: Some(0.55),
            source: Some("pr-142".into()),
        })
        .await;
    tokens
        .add(TokenDelta {
            model: "claude-haiku-4-5".into(),
            input_tokens: 145_000,
            output_tokens: 31_000,
            cost_usd: Some(0.10),
            source: Some("pr-142".into()),
        })
        .await;
    tokens
        .add(TokenDelta {
            model: "claude-sonnet-4-6".into(),
            input_tokens: 8_000,
            output_tokens: 1_500,
            cost_usd: Some(0.08),
            source: Some("lint-fix".into()),
        })
        .await;

    // Demo scratchpad
    scratchpad
        .add("Agent started working on PR review backlog (47 PRs)".into(), "agent".into())
        .await;
    scratchpad.add("Skip PRs from bots — I'll filter those out".into(), "user".into()).await;
    scratchpad
        .add(
            "Noted. Filtering bot-authored PRs. Starting with highest-risk changes.".into(),
            "agent".into(),
        )
        .await;

    // Demo checkpoints
    checkpoints
        .create(
            "Fetched PR list".into(),
            Some("Retrieved 47 open PRs from GitHub".into()),
            Some(10),
            Some("pr-review".into()),
        )
        .await;
    checkpoints
        .create(
            "Filtered bot PRs".into(),
            Some("12 bot PRs excluded, 35 remain".into()),
            Some(25),
            Some("pr-review".into()),
        )
        .await;
    checkpoints
        .create(
            "Reviewed PROJ-142".into(),
            Some("High risk: auth changes detected".into()),
            Some(40),
            Some("pr-review".into()),
        )
        .await;
    checkpoints
        .create(
            "Reviewing PROJ-156".into(),
            Some("In progress...".into()),
            Some(45),
            Some("pr-review".into()),
        )
        .await;

    // Demo log tail
    logtail
        .append(
            vec![
                "$ tsc --noEmit".into(),
                "src/api.ts:42:10 - error TS2322: Type 'string' is not assignable to type 'number'"
                    .into(),
                "Found 1 error.".into(),
            ],
            "stderr".into(),
        )
        .await;
    logtail.append(vec!["Running eslint...".into(), "✓ 0 problems".into()], "stdout".into()).await;
    logtail
        .append(
            vec![
                "Running tests...".into(),
                "  ✓ auth/session.test.ts (12 tests)".into(),
                "  ✓ api/routes.test.ts (8 tests)".into(),
                "Test suites: 2 passed, 2 total".into(),
            ],
            "stdout".into(),
        )
        .await;

    // Demo queue
    queue
        .push(
            "Review PR #142 auth changes".into(),
            Some("Session TTL modification — needs security review".into()),
            10,
            Some("claude-code".into()),
        )
        .await;
    queue
        .push(
            "Review PR #156 API refactor".into(),
            Some("Large refactor, ~400 lines changed".into()),
            8,
            Some("claude-code".into()),
        )
        .await;
    queue.push("Update changelog".into(), None, 5, Some("claude-code".into())).await;
    queue
        .push(
            "Run full test suite".into(),
            Some("After all PR reviews complete".into()),
            3,
            Some("claude-code".into()),
        )
        .await;
}

#[tauri::command]
async fn demo_seed(
    store: tauri::State<'_, Arc<KlaxonStore>>,
    timer: tauri::State<'_, Arc<TimerStore>>,
    tokens: tauri::State<'_, Arc<TokenStore>>,
    scratchpad: tauri::State<'_, Arc<ScratchpadStore>>,
    checkpoints: tauri::State<'_, Arc<CheckpointStore>>,
    logtail: tauri::State<'_, Arc<LogTailStore>>,
    queue: tauri::State<'_, Arc<QueueStore>>,
) -> Result<(), String> {
    demo_seed_inner(
        store.inner().clone(),
        timer.inner().clone(),
        tokens.inner().clone(),
        scratchpad.inner().clone(),
        checkpoints.inner().clone(),
        logtail.inner().clone(),
        queue.inner().clone(),
    )
    .await;
    Ok(())
}

#[tauri::command]
async fn klaxon_demo_create(state: tauri::State<'_, Arc<KlaxonStore>>) -> Result<String, String> {
    let it = state
        .notify(
            KlaxonLevel::Info,
            "Demo".to_string(),
            "This is a demo notification".to_string(),
            Some(60_000),
        )
        .await;
    Ok(it.id.to_string())
}

// ─── Window / panel commands ──────────────────────────────────────────────────

#[tauri::command]
fn start_panel_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn resize_window(
    app: tauri::AppHandle,
    label: String,
    width: f64,
    height: f64,
) -> Result<(), String> {
    app.get_webview_window(&label)
        .ok_or_else(|| format!("window {label} not found"))?
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_panel_always_on_top(
    app: tauri::AppHandle,
    label: String,
    on_top: bool,
) -> Result<(), String> {
    app.get_webview_window(&label)
        .ok_or_else(|| format!("window {label} not found"))?
        .set_always_on_top(on_top)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_panel(app: tauri::AppHandle, label: String) -> Result<(), String> {
    app.get_webview_window(&label)
        .ok_or_else(|| format!("window {label} not found"))?
        .hide()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn show_panel_menu(
    window: tauri::WebviewWindow,
    label: String,
    pinned: bool,
) -> Result<(), String> {
    let app = window.app_handle();
    let minimize =
        MenuItem::with_id(app, format!("pm:{label}:minimize"), "Minimize", true, None::<&str>)
            .map_err(|e| e.to_string())?;
    let pin = MenuItem::with_id(
        app,
        format!("pm:{label}:pin"),
        if pinned { "Unpin" } else { "Pin on top" },
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&minimize, &pin]).map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())
}

fn update_tray_tooltip(app: &tauri::AppHandle, count: usize) {
    if let Some(tray) = app.tray_by_id("main") {
        let label = if count == 0 { "Klaxon".into() } else { format!("Klaxon ({count} open)") };
        let _ = tray.set_tooltip(Some(&label));
    }
}

// ─── main ─────────────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .handle()
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));

            // --- SQLite pool + migrations ---
            let db_path = data_dir.join("klaxon.db");
            let pool = tauri::async_runtime::block_on(async {
                let options =
                    SqliteConnectOptions::new().filename(&db_path).create_if_missing(true);
                let pool = SqlitePoolOptions::new()
                    .max_connections(5)
                    .connect_with(options)
                    .await
                    .expect("failed to open SQLite DB");
                sqlx::migrate!("./migrations").run(&pool).await.expect("DB migration failed");
                Arc::new(pool)
            });

            // --- Stores ---
            let store = Arc::new(tauri::async_runtime::block_on(KlaxonStore::new((*pool).clone())));
            app.manage(store.clone());

            let timer_store =
                Arc::new(tauri::async_runtime::block_on(TimerStore::new((*pool).clone())));
            app.manage(timer_store.clone());

            let token_store =
                Arc::new(tauri::async_runtime::block_on(TokenStore::new((*pool).clone())));
            app.manage(token_store.clone());

            let settings_store =
                Arc::new(tauri::async_runtime::block_on(SettingsStore::new((*pool).clone())));
            app.manage(settings_store.clone());

            let scratchpad_store =
                Arc::new(tauri::async_runtime::block_on(ScratchpadStore::new((*pool).clone())));
            app.manage(scratchpad_store.clone());

            let checkpoint_store =
                Arc::new(tauri::async_runtime::block_on(CheckpointStore::new((*pool).clone())));
            app.manage(checkpoint_store.clone());

            let logtail_store = Arc::new(LogTailStore::new());
            app.manage(logtail_store.clone());

            let toollog_store = Arc::new(ToolLogStore::new());
            app.manage(toollog_store.clone());

            let alert_store =
                Arc::new(tauri::async_runtime::block_on(AlertStore::new((*pool).clone())));
            app.manage(alert_store.clone());

            let queue_store =
                Arc::new(tauri::async_runtime::block_on(QueueStore::new((*pool).clone())));
            app.manage(queue_store.clone());

            // --- MCP status state ---
            let mcp_status: Arc<Mutex<Option<McpStatus>>> = Arc::new(Mutex::new(None));
            app.manage(mcp_status.clone());

            // --- KlaxonStore event bridge ---
            let initial_count =
                tauri::async_runtime::block_on(async { store.list_open().await.len() });
            let open_count = Arc::new(AtomicUsize::new(initial_count));

            let app_handle = app.handle().clone();
            let open_count_klaxon = open_count.clone();
            let mut rx = store.events.subscribe();
            tauri::async_runtime::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(StoreEvent::Created(item)) => {
                            let _ = app_handle.emit("klaxon.created", &item);
                            let count = open_count_klaxon.fetch_add(1, Ordering::Relaxed) + 1;
                            update_tray_tooltip(&app_handle, count);
                        }
                        Ok(StoreEvent::Updated(item)) => {
                            let _ = app_handle.emit("klaxon.updated", &item);
                            if !matches!(item.status, KlaxonStatus::Open) {
                                let prev = open_count_klaxon.load(Ordering::Relaxed);
                                let count = prev.saturating_sub(1);
                                open_count_klaxon.store(count, Ordering::Relaxed);
                                update_tray_tooltip(&app_handle, count);
                            }
                        }
                        Ok(StoreEvent::Answered { id, response }) => {
                            let _ = app_handle.emit(
                                "klaxon.answered",
                                &serde_json::json!({"id": id.to_string(), "response": response}),
                            );
                            if let Some(win) = app_handle.get_webview_window("form") {
                                let _ = win.hide();
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });

            // --- TimerStore event bridge ---
            let app_handle = app.handle().clone();
            let mut rx = timer_store.events.subscribe();
            tauri::async_runtime::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(TimerEvent::Updated) => {
                            let _ = app_handle.emit("timer.updated", serde_json::Value::Null);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });

            // --- TokenStore event bridge ---
            let app_handle = app.handle().clone();
            let mut rx = token_store.events.subscribe();
            tauri::async_runtime::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(TokenEvent::Updated) => {
                            let _ = app_handle.emit("tokens.updated", serde_json::Value::Null);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });

            // --- ScratchpadStore event bridge ---
            let app_handle = app.handle().clone();
            let mut rx = scratchpad_store.events.subscribe();
            tauri::async_runtime::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(ScratchpadEvent::Updated) => {
                            let _ = app_handle.emit("scratchpad.updated", serde_json::Value::Null);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });

            // --- CheckpointStore event bridge ---
            let app_handle = app.handle().clone();
            let mut rx = checkpoint_store.events.subscribe();
            tauri::async_runtime::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(CheckpointEvent::Updated) => {
                            let _ = app_handle.emit("checkpoints.updated", serde_json::Value::Null);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });

            // --- LogTailStore event bridge ---
            let app_handle = app.handle().clone();
            let mut rx = logtail_store.events.subscribe();
            tauri::async_runtime::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(LogTailEvent::Updated) => {
                            let _ = app_handle.emit("logtail.updated", serde_json::Value::Null);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });

            // --- ToolLogStore event bridge ---
            let app_handle = app.handle().clone();
            let mut rx = toollog_store.events.subscribe();
            tauri::async_runtime::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(ToolLogEvent::Updated) => {
                            let _ = app_handle.emit("toollog.updated", serde_json::Value::Null);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });

            // --- AlertStore event bridge ---
            let app_handle = app.handle().clone();
            let mut rx = alert_store.events.subscribe();
            tauri::async_runtime::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(AlertEvent::Updated) => {
                            let _ = app_handle.emit("alerts.updated", serde_json::Value::Null);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });

            // --- QueueStore event bridge ---
            let app_handle = app.handle().clone();
            let mut rx = queue_store.events.subscribe();
            tauri::async_runtime::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(QueueEvent::Updated) => {
                            let _ = app_handle.emit("queue.updated", serde_json::Value::Null);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });

            // --- Alert evaluation loop (every 60s) ---
            {
                let store_a = store.clone();
                let timer_a = timer_store.clone();
                let tokens_a = token_store.clone();
                let alert_a = alert_store.clone();
                tauri::async_runtime::spawn(async move {
                    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
                    interval.tick().await; // skip first immediate tick
                    loop {
                        interval.tick().await;
                        let rules = alert_a.list().await;
                        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
                        for rule in rules {
                            if !rule.enabled {
                                continue;
                            }
                            if let Some(ref lf) = rule.last_fired_at {
                                if lf.starts_with(&today) {
                                    continue;
                                }
                            }
                            let should_fire = match rule.kind.as_str() {
                                "cost" => {
                                    let totals = tokens_a.today_totals().await;
                                    let cost: f64 = totals.iter().map(|t| t.cost_usd).sum();
                                    cost > rule.threshold
                                }
                                "timer" => {
                                    let active = timer_a.active_state().await;
                                    active.iter().any(|(_, start)| {
                                        let secs = (chrono::Utc::now() - *start).num_seconds();
                                        secs > (rule.threshold * 3600.0) as i64
                                    })
                                }
                                "klaxon_count" => {
                                    let open = store_a.list_open().await;
                                    open.len() as f64 > rule.threshold
                                }
                                _ => false,
                            };
                            if should_fire {
                                let level = match rule.level.as_str() {
                                    "warning" => KlaxonLevel::Warning,
                                    "error" => KlaxonLevel::Error,
                                    "success" => KlaxonLevel::Success,
                                    _ => KlaxonLevel::Info,
                                };
                                store_a
                                    .notify(level, "Alert".to_string(), rule.message.clone(), None)
                                    .await;
                                alert_a.mark_fired(rule.id).await;
                            }
                        }
                    }
                });
            }

            // --- Panel windows ---
            //                    (label,         w,     h,    dx,     dy,  resizable)
            let panels: &[(&str, f64, f64, f64, f64, bool)] = &[
                ("klaxon",       400.0, 560.0,   24.0,   24.0, false),
                ("timer",        320.0, 380.0,  440.0,   24.0, false),
                ("tokens",       400.0, 280.0,  780.0,   24.0, false),
                ("settings",     360.0, 420.0, 1100.0,   24.0, false),
                ("form",         480.0, 600.0,  200.0,  100.0, false),
                ("history",      500.0, 620.0,   24.0,  610.0, false),
                ("timer-report", 480.0, 420.0,  440.0,  430.0, false),
                ("budget",       280.0, 360.0,  780.0,  320.0, false),
                ("agents",       320.0, 400.0, 1100.0,  460.0, false),
                ("session",      460.0, 300.0,  440.0,  430.0, false),
                ("scratchpad",   360.0, 520.0, 1100.0,  610.0, false),
                ("checkpoints",  440.0, 500.0,  440.0,  860.0, false),
                ("logtail",      560.0, 500.0,   24.0, 1260.0, false),
                ("toollog",      560.0, 500.0,  600.0, 1260.0, false),
                ("queue",        560.0, 580.0,  600.0,  430.0, false),
            ];
            for &(label, w, h, dx, dy, resizable) in panels {
                let url = tauri::WebviewUrl::App(format!("?panel={label}").into());
                tauri::WebviewWindowBuilder::new(app.handle(), label, url)
                    .title(label)
                    .inner_size(w, h)
                    .position(dx, dy)
                    .resizable(resizable)
                    .transparent(true)
                    .decorations(false)
                    .shadow(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .visible_on_all_workspaces(true)
                    .build()?;
            }
            if let Some(win) = app.get_webview_window("form") {
                let _ = win.hide();
            }

            // --- MCP Server ---
            let app_handle = app.handle().clone();
            let preferred_port = tauri::async_runtime::block_on(async {
                settings_store.get().await.mcp_preferred_port
            });
            tauri::async_runtime::spawn(async move {
                let (addr, bearer, agents_map, mut agent_rx) = match start_mcp_server(
                    store.clone(),
                    timer_store.clone(),
                    token_store.clone(),
                    scratchpad_store.clone(),
                    checkpoint_store.clone(),
                    logtail_store.clone(),
                    toollog_store.clone(),
                    queue_store.clone(),
                    preferred_port,
                )
                .await
                {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("Failed to start MCP server: {e:?}");
                        return;
                    }
                };

                app_handle.manage(agents_map);
                let ah2 = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        match agent_rx.recv().await {
                            Ok(()) => {
                                let _ = ah2.emit("agents.updated", serde_json::Value::Null);
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(_) => break,
                        }
                    }
                });

                eprintln!("MCP server listening at http://{addr}/mcp");
                eprintln!("MCP bearer token: {bearer}");

                let url = format!("http://{addr}/mcp");
                *mcp_status.lock().await =
                    Some(McpStatus { url: url.clone(), bearer: bearer.clone() });

                let _ = store
                    .notify(
                        KlaxonLevel::Info,
                        "Klaxon ready".to_string(),
                        format!("MCP: {url}\nToken: {bearer}"),
                        None,
                    )
                    .await;

                let _ =
                    app_handle.emit("mcp.ready", &serde_json::json!({"url": url, "token": bearer}));
            });

            // --- Panel popup menu event routing ---
            app.handle().on_menu_event(|app, event| {
                let id = event.id().as_ref();
                if let Some(rest) = id.strip_prefix("pm:") {
                    let mut parts = rest.splitn(2, ':');
                    if let (Some(label), Some(action)) = (parts.next(), parts.next()) {
                        if let Some(win) = app.get_webview_window(label) {
                            let _ = win.emit("panel.menu", serde_json::json!({ "action": action }));
                        }
                    }
                }
            });

            // --- System Tray ---
            let klaxon_item =
                MenuItem::with_id(app.handle(), "toggle-klaxon", "Klaxon", true, None::<&str>)?;
            let timer_item =
                MenuItem::with_id(app.handle(), "toggle-timer", "Timer", true, None::<&str>)?;
            let tokens_item =
                MenuItem::with_id(app.handle(), "toggle-tokens", "Tokens", true, None::<&str>)?;
            let settings_item =
                MenuItem::with_id(app.handle(), "toggle-settings", "Settings", true, None::<&str>)?;
            let history_item =
                MenuItem::with_id(app.handle(), "toggle-history", "History", true, None::<&str>)?;
            let report_item = MenuItem::with_id(
                app.handle(),
                "toggle-timer-report",
                "Timer Report",
                true,
                None::<&str>,
            )?;
            let budget_item =
                MenuItem::with_id(app.handle(), "toggle-budget", "Budget", true, None::<&str>)?;
            let agents_item =
                MenuItem::with_id(app.handle(), "toggle-agents", "Agents", true, None::<&str>)?;
            let session_item =
                MenuItem::with_id(app.handle(), "toggle-session", "Session", true, None::<&str>)?;
            let scratchpad_item = MenuItem::with_id(
                app.handle(),
                "toggle-scratchpad",
                "Scratchpad",
                true,
                None::<&str>,
            )?;
            let checkpts_item = MenuItem::with_id(
                app.handle(),
                "toggle-checkpoints",
                "Checkpoints",
                true,
                None::<&str>,
            )?;
            let logtail_item =
                MenuItem::with_id(app.handle(), "toggle-logtail", "Log Tail", true, None::<&str>)?;
            let toollog_item =
                MenuItem::with_id(app.handle(), "toggle-toollog", "Tool Log", true, None::<&str>)?;
            let queue_item =
                MenuItem::with_id(app.handle(), "toggle-queue", "Work Queue", true, None::<&str>)?;
            let demo_item =
                MenuItem::with_id(app.handle(), "demo-seed", "Run Demo", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app.handle(), "quit", "Quit", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app.handle())?;
            let sep2 = PredefinedMenuItem::separator(app.handle())?;
            let sep3 = PredefinedMenuItem::separator(app.handle())?;
            let sep4 = PredefinedMenuItem::separator(app.handle())?;
            let tray_menu = Menu::with_items(
                app.handle(),
                &[
                    &klaxon_item,
                    &timer_item,
                    &tokens_item,
                    &settings_item,
                    &sep1,
                    &history_item,
                    &report_item,
                    &budget_item,
                    &agents_item,
                    &sep2,
                    &session_item,
                    &scratchpad_item,
                    &checkpts_item,
                    &logtail_item,
                    &toollog_item,
                    &queue_item,
                    &sep3,
                    &demo_item,
                    &sep4,
                    &quit_item,
                ],
            )?;

            fn toggle_panel(app: &tauri::AppHandle, label: &str) {
                if let Some(win) = app.get_webview_window(label) {
                    if win.is_visible().unwrap_or(false) {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }

            TrayIconBuilder::with_id("main")
                .icon(tauri::include_image!("icons/icon.ico"))
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle-klaxon" => toggle_panel(app, "klaxon"),
                    "toggle-timer" => toggle_panel(app, "timer"),
                    "toggle-tokens" => toggle_panel(app, "tokens"),
                    "toggle-settings" => toggle_panel(app, "settings"),
                    "toggle-history" => toggle_panel(app, "history"),
                    "toggle-timer-report" => toggle_panel(app, "timer-report"),
                    "toggle-budget" => toggle_panel(app, "budget"),
                    "toggle-agents" => toggle_panel(app, "agents"),
                    "toggle-session" => toggle_panel(app, "session"),
                    "toggle-scratchpad" => toggle_panel(app, "scratchpad"),
                    "toggle-checkpoints" => toggle_panel(app, "checkpoints"),
                    "toggle-logtail" => toggle_panel(app, "logtail"),
                    "toggle-toollog" => toggle_panel(app, "toollog"),
                    "toggle-queue" => toggle_panel(app, "queue"),
                    "demo-seed" => {
                        let store = app.state::<Arc<KlaxonStore>>().inner().clone();
                        let timer = app.state::<Arc<TimerStore>>().inner().clone();
                        let tokens = app.state::<Arc<TokenStore>>().inner().clone();
                        let scratchpad = app.state::<Arc<ScratchpadStore>>().inner().clone();
                        let checkpoints = app.state::<Arc<CheckpointStore>>().inner().clone();
                        let logtail = app.state::<Arc<LogTailStore>>().inner().clone();
                        let queue = app.state::<Arc<QueueStore>>().inner().clone();
                        tauri::async_runtime::spawn(demo_seed_inner(
                            store,
                            timer,
                            tokens,
                            scratchpad,
                            checkpoints,
                            logtail,
                            queue,
                        ));
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        for label in ["klaxon", "timer", "tokens"] {
                            if let Some(win) = app.get_webview_window(label) {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            klaxon_list_open,
            klaxon_list_all,
            klaxon_list_answered,
            klaxon_ack,
            klaxon_dismiss,
            klaxon_answer,
            klaxon_run_action,
            klaxon_get_item,
            klaxon_open_form,
            klaxon_demo_create,
            demo_seed,
            timer_start,
            timer_stop,
            timer_switch,
            timer_today,
            timer_active,
            timer_week,
            tokens_today,
            tokens_add,
            tokens_week,
            tokens_by_source,
            settings_get,
            settings_set,
            mcp_get_status,
            mcp_list_agents,
            scratchpad_list,
            scratchpad_add,
            scratchpad_clear,
            checkpoints_list,
            checkpoints_clear,
            logtail_recent,
            logtail_clear,
            toollog_recent,
            toollog_clear,
            alerts_list,
            alerts_create,
            alerts_update,
            alerts_delete,
            queue_list,
            queue_update,
            queue_cancel_pending,
            session_summary,
            session_end,
            start_panel_drag,
            set_panel_always_on_top,
            hide_panel,
            show_panel_menu,
            resize_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
