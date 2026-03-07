use std::{collections::HashMap, path::PathBuf};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerEntry {
  pub issue_id: String,
  pub start: DateTime<Utc>,
  pub end: DateTime<Utc>,
  pub seconds: u64,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActiveTimer {
  issue_id: String,
  start: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Persisted {
  #[serde(default)]
  active: HashMap<String, ActiveTimer>,
  entries: Vec<TimerEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IssueSummary {
  pub issue_id: String,
  /// Completed (stopped) seconds only. Client adds live elapsed via active_since.
  pub seconds: u64,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub active_since: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub enum TimerEvent {
  Updated,
}

#[derive(Debug)]
pub struct TimerStore {
  path: PathBuf,
  inner: Mutex<Persisted>,
  pub events: broadcast::Sender<TimerEvent>,
}

impl TimerStore {
  pub async fn new(path: PathBuf) -> Self {
    let (tx, _rx) = broadcast::channel(64);
    let data = if let Ok(bytes) = tokio::fs::read(&path).await {
      serde_json::from_slice::<Persisted>(&bytes)
        .unwrap_or_else(|_| Persisted { active: HashMap::new(), entries: vec![] })
    } else {
      Persisted { active: HashMap::new(), entries: vec![] }
    };
    Self { path, inner: Mutex::new(data), events: tx }
  }

  async fn persist(&self, data: &Persisted) {
    if let Ok(json) = serde_json::to_vec_pretty(data) {
      let _ = tokio::fs::create_dir_all(
        self.path.parent().unwrap_or_else(|| std::path::Path::new(".")),
      )
      .await;
      let _ = tokio::fs::write(&self.path, json).await;
    }
  }

  pub async fn start(&self, issue_id: String) -> Result<(), String> {
    let mut data = self.inner.lock().await;
    if data.active.contains_key(&issue_id) {
      return Err(format!("{issue_id} is already running"));
    }
    data.active.insert(issue_id.clone(), ActiveTimer { issue_id, start: Utc::now() });
    self.persist(&data).await;
    let _ = self.events.send(TimerEvent::Updated);
    Ok(())
  }

  pub async fn stop(&self, issue_id: &str) -> Option<TimerEntry> {
    let mut data = self.inner.lock().await;
    let active = data.active.remove(issue_id)?;
    let end = Utc::now();
    let seconds = (end - active.start).num_seconds().max(0) as u64;
    let entry = TimerEntry { issue_id: active.issue_id, start: active.start, end, seconds, note: None };
    data.entries.push(entry.clone());
    self.persist(&data).await;
    let _ = self.events.send(TimerEvent::Updated);
    Some(entry)
  }

  pub async fn stop_all(&self) -> Vec<TimerEntry> {
    let ids: Vec<String> = self.inner.lock().await.active.keys().cloned().collect();
    let mut out = Vec::new();
    for id in ids {
      if let Some(e) = self.stop(&id).await {
        out.push(e);
      }
    }
    out
  }

  /// Stop all active timers then start a new one (MCP switch semantics).
  pub async fn switch(&self, issue_id: String) -> Vec<TimerEntry> {
    let stopped = self.stop_all().await;
    let _ = self.start(issue_id).await;
    stopped
  }

  pub async fn today_summary(&self) -> Vec<IssueSummary> {
    let data = self.inner.lock().await;
    let today = Utc::now().date_naive();
    let mut completed: HashMap<String, u64> = HashMap::new();

    for entry in &data.entries {
      if entry.start.date_naive() == today {
        *completed.entry(entry.issue_id.clone()).or_insert(0) += entry.seconds;
      }
    }

    // Build rows from completed entries, merging active_since where applicable.
    let mut out: Vec<IssueSummary> = completed
      .into_iter()
      .map(|(issue_id, seconds)| {
        let active_since = data.active.get(&issue_id).map(|a| a.start);
        IssueSummary { issue_id, seconds, active_since }
      })
      .collect();

    // Add active timers that have no completed entries today yet.
    for (issue_id, active) in &data.active {
      if !out.iter().any(|s| &s.issue_id == issue_id) {
        out.push(IssueSummary { issue_id: issue_id.clone(), seconds: 0, active_since: Some(active.start) });
      }
    }

    // Active entries first, then by most completed seconds.
    out.sort_by(|a, b| {
      b.active_since.is_some().cmp(&a.active_since.is_some())
        .then(b.seconds.cmp(&a.seconds))
    });
    out
  }

  pub async fn active_state(&self) -> Vec<(String, DateTime<Utc>)> {
    let data = self.inner.lock().await;
    data.active.values().map(|a| (a.issue_id.clone(), a.start)).collect()
  }

  pub async fn seed_demo(&self) {
    let now = Utc::now();
    let today = now.date_naive();
    let mut inner = self.inner.lock().await;

    inner.entries.push(TimerEntry {
      issue_id: "PROJ-456".into(),
      start: today.and_hms_opt(9, 0, 0).unwrap().and_utc(),
      end:   today.and_hms_opt(11, 18, 0).unwrap().and_utc(),
      seconds: 8280,
      note: None,
    });
    inner.entries.push(TimerEntry {
      issue_id: "PROJ-789".into(),
      start: today.and_hms_opt(13, 0, 0).unwrap().and_utc(),
      end:   today.and_hms_opt(13, 45, 0).unwrap().and_utc(),
      seconds: 2700,
      note: None,
    });

    inner.active.insert("PROJ-001".into(), ActiveTimer {
      issue_id: "PROJ-001".into(),
      start: now - Duration::minutes(3),
    });

    self.persist(&inner).await;
    let _ = self.events.send(TimerEvent::Updated);
  }
}
