#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mcp_http;
mod models;
mod settings_store;
mod store;
mod timer_store;
mod token_store;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::{
  mcp_http::start_mcp_server,
  models::{KlaxonLevel, KlaxonStatus},
  settings_store::{AppSettings, SettingsStore},
  store::{KlaxonStore, StoreEvent},
  timer_store::{TimerStore, TimerEvent},
  token_store::{TokenStore, TokenEvent, TokenDelta},
};

#[derive(Debug, Clone, serde::Serialize)]
struct McpStatus {
  url: String,
  bearer: String,
}

#[tauri::command]
async fn klaxon_list_open(state: tauri::State<'_, Arc<KlaxonStore>>) -> Result<Vec<crate::models::KlaxonItem>, String> {
  Ok(state.list_open().await)
}

#[tauri::command]
async fn klaxon_ack(state: tauri::State<'_, Arc<KlaxonStore>>, id: String) -> Result<(), String> {
  let uuid = Uuid::parse_str(&id).map_err(|_| "invalid id".to_string())?;
  state.ack(uuid).await;
  Ok(())
}

#[tauri::command]
async fn klaxon_dismiss(state: tauri::State<'_, Arc<KlaxonStore>>, id: String) -> Result<(), String> {
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
    crate::models::KlaxonAction::OpenUrl { url, .. } => {
      Ok(KlaxonRunActionResult { kind: "open_url".into(), url: Some(url), tool: None, arguments: None })
    }
    crate::models::KlaxonAction::RunTool { tool, arguments, .. } => {
      Ok(KlaxonRunActionResult { kind: "run_tool".into(), url: None, tool: Some(tool), arguments: Some(arguments) })
    }
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

async fn demo_seed_inner(
  store: Arc<KlaxonStore>,
  timer: Arc<TimerStore>,
  tokens: Arc<TokenStore>,
) {
  use crate::models::{KlaxonAction, KlaxonForm, KlaxonLevel, FormField};

  let item = store.notify(
    KlaxonLevel::Info,
    "Agent Status".into(),
    "3 tasks completed, 1 in progress. Running `code-review` on PR #142.".into(),
    None,
  ).await;
  store.set_actions(item.id, vec![
    KlaxonAction::RunTool { id: "run".into(), label: "View Task".into(), tool: "task.view".into(), arguments: serde_json::json!({"id": "pr-142"}) },
    KlaxonAction::Ack    { id: "ack".into(), label: "Got it".into() },
  ]).await;

  store.notify(
    KlaxonLevel::Warning,
    "Context Window at 87%".into(),
    "Consider summarising or starting a new session before the limit is reached.".into(),
    Some(120_000),
  ).await;

  let item = store.notify(
    KlaxonLevel::Error,
    "Build Failed".into(),
    "TypeScript error in src/api.ts:\n  Type 'string' is not assignable to 'number' (line 42)".into(),
    None,
  ).await;
  store.set_actions(item.id, vec![
    KlaxonAction::OpenUrl { id: "logs".into(), label: "View Logs".into(), url: "https://example.com/build-logs".into() },
    KlaxonAction::Ack    { id: "ack".into(),  label: "Dismiss".into() },
  ]).await;

  store.ask(
    KlaxonLevel::Info,
    "Approve Code Change".into(),
    "The agent wants to modify src/auth/session.ts".into(),
    KlaxonForm {
      id: "demo-diff".into(),
      title: "Review Change".into(),
      description: "Approve or reject the proposed diff.".into(),
      fields: vec![
        FormField::DiffApproval {
          id: "decision".into(),
          label: "Proposed change".into(),
          diff: "+ const SESSION_TTL = 86400;\n- const SESSION_TTL = 3600;".into(),
          approve_label: "Approve".into(),
          reject_label: "Reject".into(),
          required: true,
        },
      ],
      submit_label: Some("Submit".into()),
      cancel_label: Some("Cancel".into()),
    },
    None,
  ).await;

  timer.seed_demo().await;

  tokens.add(TokenDelta { model: "claude-opus-4-6".into(),   input_tokens: 12_840,  output_tokens: 2_460,  cost_usd: Some(1.89), source: Some("demo".into()) }).await;
  tokens.add(TokenDelta { model: "claude-sonnet-4-6".into(), input_tokens: 52_300,  output_tokens: 11_200, cost_usd: Some(0.55), source: Some("demo".into()) }).await;
  tokens.add(TokenDelta { model: "claude-haiku-4-5".into(),  input_tokens: 145_000, output_tokens: 31_000, cost_usd: Some(0.10), source: Some("demo".into()) }).await;
}

#[tauri::command]
async fn demo_seed(
  store:  tauri::State<'_, Arc<KlaxonStore>>,
  timer:  tauri::State<'_, Arc<TimerStore>>,
  tokens: tauri::State<'_, Arc<TokenStore>>,
) -> Result<(), String> {
  demo_seed_inner(store.inner().clone(), timer.inner().clone(), tokens.inner().clone()).await;
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

#[tauri::command]
async fn timer_start(state: tauri::State<'_, Arc<TimerStore>>, issue_id: String) -> Result<(), String> {
  state.start(issue_id).await
}

#[tauri::command]
async fn timer_stop(state: tauri::State<'_, Arc<TimerStore>>, issue_id: String) -> Result<(), String> {
  state.stop(&issue_id).await;
  Ok(())
}

#[tauri::command]
async fn timer_switch(state: tauri::State<'_, Arc<TimerStore>>, issue_id: String) -> Result<(), String> {
  state.switch(issue_id).await;
  Ok(())
}

#[tauri::command]
async fn timer_today(state: tauri::State<'_, Arc<TimerStore>>) -> Result<Vec<crate::timer_store::IssueSummary>, String> {
  Ok(state.today_summary().await)
}

#[tauri::command]
async fn timer_active(state: tauri::State<'_, Arc<TimerStore>>) -> Result<Vec<serde_json::Value>, String> {
  let v = state.active_state().await
    .into_iter()
    .map(|(issue_id, start)| serde_json::json!({ "issue_id": issue_id, "start": start.to_rfc3339() }))
    .collect();
  Ok(v)
}

#[tauri::command]
async fn tokens_today(state: tauri::State<'_, Arc<TokenStore>>) -> Result<Vec<crate::token_store::ModelTotals>, String> {
  Ok(state.today_totals().await)
}

#[tauri::command]
async fn tokens_add(state: tauri::State<'_, Arc<TokenStore>>, delta: TokenDelta) -> Result<(), String> {
  state.add(delta).await;
  Ok(())
}

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

#[tauri::command]
async fn mcp_get_status(
  state: tauri::State<'_, Arc<Mutex<Option<McpStatus>>>>,
) -> Result<Option<McpStatus>, String> {
  Ok(state.lock().await.clone())
}

#[tauri::command]
fn start_panel_drag(window: tauri::WebviewWindow) -> Result<(), String> {
  window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn resize_window(app: tauri::AppHandle, label: String, width: f64, height: f64) -> Result<(), String> {
  app.get_webview_window(&label)
    .ok_or_else(|| format!("window {label} not found"))?
    .set_size(tauri::LogicalSize::new(width, height))
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_panel_always_on_top(app: tauri::AppHandle, label: String, on_top: bool) -> Result<(), String> {
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
fn show_panel_menu(window: tauri::WebviewWindow, label: String, pinned: bool) -> Result<(), String> {
  let app = window.app_handle();
  let minimize = MenuItem::with_id(app, format!("pm:{}:minimize", label), "Minimize", true, None::<&str>)
    .map_err(|e| e.to_string())?;
  let pin = MenuItem::with_id(app, format!("pm:{}:pin", label), if pinned { "Unpin" } else { "Pin on top" }, true, None::<&str>)
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

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      let data_dir = app.handle().path().app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

      // --- SQLite pool + migrations ---
      let db_path = data_dir.join("klaxon.db");
      let pool = tauri::async_runtime::block_on(async {
        let options = SqliteConnectOptions::new()
          .filename(&db_path)
          .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
          .max_connections(5)
          .connect_with(options)
          .await
          .expect("failed to open SQLite DB");
        sqlx::migrate!("./migrations")
          .run(&pool)
          .await
          .expect("DB migration failed");
        Arc::new(pool)
      });

      // --- Stores ---
      let store = Arc::new(tauri::async_runtime::block_on(KlaxonStore::new((*pool).clone())));
      app.manage(store.clone());

      let timer_store = Arc::new(tauri::async_runtime::block_on(TimerStore::new((*pool).clone())));
      app.manage(timer_store.clone());

      let token_store = Arc::new(tauri::async_runtime::block_on(TokenStore::new((*pool).clone())));
      app.manage(token_store.clone());

      let settings_store = Arc::new(tauri::async_runtime::block_on(SettingsStore::new((*pool).clone())));
      app.manage(settings_store.clone());

      // --- MCP status state ---
      let mcp_status: Arc<Mutex<Option<McpStatus>>> = Arc::new(Mutex::new(None));
      app.manage(mcp_status.clone());

      // --- KlaxonStore event bridge ---
      let initial_count = tauri::async_runtime::block_on(async { store.list_open().await.len() });
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
            Ok(TimerEvent::Updated) => { let _ = app_handle.emit("timer.updated", serde_json::Value::Null); }
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
            Ok(TokenEvent::Updated) => { let _ = app_handle.emit("tokens.updated", serde_json::Value::Null); }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(_) => break,
          }
        }
      });

      // --- Panel windows ---
      let panels: &[(&str, f64, f64, f64, f64)] = &[
        ("klaxon",   400.0, 560.0, 24.0,   24.0),
        ("timer",    320.0, 380.0, 440.0,  24.0),
        ("tokens",   300.0, 280.0, 780.0,  24.0),
        ("settings", 340.0, 420.0, 1100.0, 24.0),
      ];
      for &(label, w, h, dx, dy) in panels {
        let url = tauri::WebviewUrl::App(format!("?panel={label}").into());
        tauri::WebviewWindowBuilder::new(app.handle(), label, url)
          .title(label)
          .inner_size(w, h)
          .position(dx, dy)
          .transparent(true)
          .decorations(false)
          .shadow(false)
          .always_on_top(true)
          .skip_taskbar(true)
          .visible_on_all_workspaces(true)
          .build()?;
      }

      // --- MCP Server ---
      let app_handle = app.handle().clone();
      let preferred_port = tauri::async_runtime::block_on(async {
        settings_store.get().await.mcp_preferred_port
      });
      tauri::async_runtime::spawn(async move {
        let (addr, bearer) = match start_mcp_server(store.clone(), timer_store.clone(), token_store.clone(), preferred_port).await {
          Ok(v) => v,
          Err(e) => {
            eprintln!("Failed to start MCP server: {e:?}");
            return;
          }
        };

        eprintln!("MCP server listening at http://{}/mcp", addr);
        eprintln!("MCP bearer token: {}", bearer);

        let url = format!("http://{}/mcp", addr);
        *mcp_status.lock().await = Some(McpStatus { url: url.clone(), bearer: bearer.clone() });

        let _ = store
          .notify(
            KlaxonLevel::Info,
            "Klaxon ready".to_string(),
            format!("MCP: {url}\nToken: {bearer}"),
            None,
          )
          .await;

        let _ = app_handle.emit(
          "mcp.ready",
          &serde_json::json!({"url": url, "token": bearer}),
        );
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
      let klaxon_item   = MenuItem::with_id(app.handle(), "toggle-klaxon",   "Klaxon",   true, None::<&str>)?;
      let timer_item    = MenuItem::with_id(app.handle(), "toggle-timer",    "Timer",    true, None::<&str>)?;
      let tokens_item   = MenuItem::with_id(app.handle(), "toggle-tokens",   "Tokens",   true, None::<&str>)?;
      let settings_item = MenuItem::with_id(app.handle(), "toggle-settings", "Settings", true, None::<&str>)?;
      let demo_item     = MenuItem::with_id(app.handle(), "demo-seed",       "Run Demo", true, None::<&str>)?;
      let quit_item     = MenuItem::with_id(app.handle(), "quit",            "Quit",     true, None::<&str>)?;
      let sep1 = PredefinedMenuItem::separator(app.handle())?;
      let sep2 = PredefinedMenuItem::separator(app.handle())?;
      let tray_menu = Menu::with_items(app.handle(), &[
        &klaxon_item, &timer_item, &tokens_item, &settings_item,
        &sep1, &demo_item, &sep2,
        &quit_item,
      ])?;

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
          "toggle-klaxon"   => toggle_panel(app, "klaxon"),
          "toggle-timer"    => toggle_panel(app, "timer"),
          "toggle-tokens"   => toggle_panel(app, "tokens"),
          "toggle-settings" => toggle_panel(app, "settings"),
          "demo-seed" => {
            let store  = app.state::<Arc<KlaxonStore>>().inner().clone();
            let timer  = app.state::<Arc<TimerStore>>().inner().clone();
            let tokens = app.state::<Arc<TokenStore>>().inner().clone();
            tauri::async_runtime::spawn(demo_seed_inner(store, timer, tokens));
          }
          "quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
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
      klaxon_ack,
      klaxon_dismiss,
      klaxon_answer,
      klaxon_run_action,
      klaxon_demo_create,
      demo_seed,
      timer_start,
      timer_stop,
      timer_switch,
      timer_today,
      timer_active,
      tokens_today,
      tokens_add,
      settings_get,
      settings_set,
      mcp_get_status,
      start_panel_drag,
      set_panel_always_on_top,
      hide_panel,
      show_panel_menu,
      resize_window,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
