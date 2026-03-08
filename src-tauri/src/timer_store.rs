use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerEntry {
  pub issue_id: String,
  pub start: DateTime<Utc>,
  pub end: DateTime<Utc>,
  pub seconds: u64,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IssueSummary {
  pub issue_id: String,
  pub seconds: u64,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub active_since: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WeekEntry {
  pub issue_id: String,
  pub date: String,
  pub seconds: u64,
}

#[derive(Debug, Clone)]
pub enum TimerEvent {
  Updated,
}

#[derive(Debug)]
pub struct TimerStore {
  pool: SqlitePool,
  pub events: broadcast::Sender<TimerEvent>,
}

impl TimerStore {
  pub async fn new(pool: SqlitePool) -> Self {
    let (tx, _rx) = broadcast::channel(64);
    Self { pool, events: tx }
  }

  pub async fn start(&self, issue_id: String) -> Result<(), String> {
    let existing = sqlx::query("SELECT issue_id FROM timer_active WHERE issue_id = ?")
      .bind(&issue_id)
      .fetch_optional(&self.pool)
      .await
      .map_err(|e| e.to_string())?;
    if existing.is_some() {
      return Err(format!("{issue_id} is already running"));
    }
    sqlx::query("INSERT INTO timer_active (issue_id, start) VALUES (?, ?)")
      .bind(&issue_id)
      .bind(Utc::now().to_rfc3339())
      .execute(&self.pool)
      .await
      .map_err(|e| e.to_string())?;
    let _ = self.events.send(TimerEvent::Updated);
    Ok(())
  }

  pub async fn stop(&self, issue_id: &str) -> Option<TimerEntry> {
    let row = sqlx::query("SELECT issue_id, start FROM timer_active WHERE issue_id = ?")
      .bind(issue_id)
      .fetch_optional(&self.pool)
      .await
      .ok()??;

    let start_str: String = row.try_get("start").ok()?;
    let start = chrono::DateTime::parse_from_rfc3339(&start_str)
      .ok()?
      .with_timezone(&Utc);
    let end = Utc::now();
    let seconds = (end - start).num_seconds().max(0) as u64;
    let date = start.format("%Y-%m-%d").to_string();

    let _ = sqlx::query(
      "INSERT INTO timer_entries (issue_id, start, end, seconds, date) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(issue_id)
    .bind(start.to_rfc3339())
    .bind(end.to_rfc3339())
    .bind(seconds as i64)
    .bind(&date)
    .execute(&self.pool)
    .await;

    let _ = sqlx::query("DELETE FROM timer_active WHERE issue_id = ?")
      .bind(issue_id)
      .execute(&self.pool)
      .await;

    let _ = self.events.send(TimerEvent::Updated);
    Some(TimerEntry { issue_id: issue_id.to_string(), start, end, seconds, note: None })
  }

  pub async fn stop_all(&self) -> Vec<TimerEntry> {
    let rows = sqlx::query("SELECT issue_id FROM timer_active")
      .fetch_all(&self.pool)
      .await
      .unwrap_or_default();
    let ids: Vec<String> = rows.iter().filter_map(|r| r.try_get("issue_id").ok()).collect();
    let mut out = Vec::new();
    for id in ids {
      if let Some(e) = self.stop(&id).await {
        out.push(e);
      }
    }
    out
  }

  pub async fn switch(&self, issue_id: String) -> Vec<TimerEntry> {
    let stopped = self.stop_all().await;
    let _ = self.start(issue_id).await;
    stopped
  }

  pub async fn week_summary(&self) -> Vec<WeekEntry> {
    let rows = sqlx::query(
      "SELECT issue_id, date, SUM(seconds) as total_seconds \
       FROM timer_entries \
       WHERE date >= date('now', '-6 days') \
       GROUP BY issue_id, date \
       ORDER BY date DESC, total_seconds DESC",
    )
    .fetch_all(&self.pool)
    .await
    .unwrap_or_default();

    rows.iter()
      .filter_map(|r| {
        let issue_id: String = r.try_get("issue_id").ok()?;
        let date: String = r.try_get("date").ok()?;
        let total: i64 = r.try_get("total_seconds").ok()?;
        Some(WeekEntry { issue_id, date, seconds: total as u64 })
      })
      .collect()
  }

  pub async fn today_summary(&self) -> Vec<IssueSummary> {
    let today = Utc::now().format("%Y-%m-%d").to_string();

    let completed_rows = sqlx::query(
      "SELECT issue_id, SUM(seconds) as total_seconds FROM timer_entries WHERE date = ? GROUP BY issue_id",
    )
    .bind(&today)
    .fetch_all(&self.pool)
    .await
    .unwrap_or_default();

    let active_rows = sqlx::query("SELECT issue_id, start FROM timer_active")
      .fetch_all(&self.pool)
      .await
      .unwrap_or_default();

    let mut summaries: Vec<IssueSummary> = completed_rows
      .iter()
      .filter_map(|r| {
        let issue_id: String = r.try_get("issue_id").ok()?;
        let total: i64 = r.try_get("total_seconds").ok()?;
        Some(IssueSummary { issue_id, seconds: total as u64, active_since: None })
      })
      .collect();

    // Merge active_since into existing entries or add new rows
    for row in &active_rows {
      let Ok(issue_id): Result<String, _> = row.try_get("issue_id") else { continue };
      let Ok(start_str): Result<String, _> = row.try_get("start") else { continue };
      let active_since = chrono::DateTime::parse_from_rfc3339(&start_str)
        .ok()
        .map(|d| d.with_timezone(&Utc));

      if let Some(s) = summaries.iter_mut().find(|s| s.issue_id == issue_id) {
        s.active_since = active_since;
      } else {
        summaries.push(IssueSummary { issue_id, seconds: 0, active_since });
      }
    }

    summaries.sort_by(|a, b| {
      b.active_since.is_some().cmp(&a.active_since.is_some()).then(b.seconds.cmp(&a.seconds))
    });
    summaries
  }

  pub async fn active_state(&self) -> Vec<(String, DateTime<Utc>)> {
    let rows = sqlx::query("SELECT issue_id, start FROM timer_active")
      .fetch_all(&self.pool)
      .await
      .unwrap_or_default();
    rows.iter()
      .filter_map(|r| {
        let issue_id: String = r.try_get("issue_id").ok()?;
        let start_str: String = r.try_get("start").ok()?;
        let start =
          chrono::DateTime::parse_from_rfc3339(&start_str).ok()?.with_timezone(&Utc);
        Some((issue_id, start))
      })
      .collect()
  }

  pub async fn seed_demo(&self) {
    let now = Utc::now();
    let today = now.format("%Y-%m-%d").to_string();

    let entries = [
      ("PROJ-456", "09:00:00", "11:18:00", 8280i64),
      ("PROJ-789", "13:00:00", "13:45:00", 2700i64),
    ];

    for (issue_id, start_time, end_time, seconds) in &entries {
      let start_str = format!("{today}T{start_time}Z");
      let end_str = format!("{today}T{end_time}Z");
      let _ = sqlx::query(
        "INSERT INTO timer_entries (issue_id, start, end, seconds, date) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(issue_id)
      .bind(&start_str)
      .bind(&end_str)
      .bind(seconds)
      .bind(&today)
      .execute(&self.pool)
      .await;
    }

    let active_start = (now - Duration::minutes(3)).to_rfc3339();
    let _ = sqlx::query(
      "INSERT OR REPLACE INTO timer_active (issue_id, start) VALUES (?, ?)",
    )
    .bind("PROJ-001")
    .bind(&active_start)
    .execute(&self.pool)
    .await;

    let _ = self.events.send(TimerEvent::Updated);
  }
}
