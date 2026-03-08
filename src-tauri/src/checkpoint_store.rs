use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
  pub id: i64,
  pub label: String,
  pub detail: Option<String>,
  pub progress_pct: Option<i64>,
  pub session_tag: Option<String>,
  pub created_at: String,
}

#[derive(Debug, Clone)]
pub enum CheckpointEvent {
  Updated,
}

#[derive(Debug)]
pub struct CheckpointStore {
  pool: SqlitePool,
  pub events: broadcast::Sender<CheckpointEvent>,
}

impl CheckpointStore {
  pub async fn new(pool: SqlitePool) -> Self {
    let (tx, _rx) = broadcast::channel(64);
    Self { pool, events: tx }
  }

  pub async fn create(
    &self,
    label: String,
    detail: Option<String>,
    progress_pct: Option<i64>,
    session_tag: Option<String>,
  ) -> Checkpoint {
    let now = Utc::now().to_rfc3339();
    let result = sqlx::query(
      "INSERT INTO checkpoints (label, detail, progress_pct, session_tag, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&label)
    .bind(&detail)
    .bind(progress_pct)
    .bind(&session_tag)
    .bind(&now)
    .execute(&self.pool)
    .await;

    let id = result.map(|r| r.last_insert_rowid()).unwrap_or(0);
    let cp = Checkpoint { id, label, detail, progress_pct, session_tag, created_at: now };
    let _ = self.events.send(CheckpointEvent::Updated);
    cp
  }

  pub async fn list(&self, limit: i64) -> Vec<Checkpoint> {
    sqlx::query(
      "SELECT id, label, detail, progress_pct, session_tag, created_at \
       FROM checkpoints ORDER BY id DESC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(&self.pool)
    .await
    .map(|rows| {
      rows.iter()
        .filter_map(|r| {
          let id: i64 = r.try_get("id").ok()?;
          let label: String = r.try_get("label").ok()?;
          let detail: Option<String> = r.try_get("detail").ok().flatten();
          let progress_pct: Option<i64> = r.try_get("progress_pct").ok().flatten();
          let session_tag: Option<String> = r.try_get("session_tag").ok().flatten();
          let created_at: String = r.try_get("created_at").ok()?;
          Some(Checkpoint { id, label, detail, progress_pct, session_tag, created_at })
        })
        .collect()
    })
    .unwrap_or_default()
  }

  pub async fn clear(&self, session_tag: Option<String>) {
    if let Some(tag) = session_tag {
      let _ = sqlx::query("DELETE FROM checkpoints WHERE session_tag = ?")
        .bind(tag)
        .execute(&self.pool)
        .await;
    } else {
      let _ = sqlx::query("DELETE FROM checkpoints").execute(&self.pool).await;
    }
    let _ = self.events.send(CheckpointEvent::Updated);
  }
}
