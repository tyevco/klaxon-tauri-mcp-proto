use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItem {
  pub id: i64,
  pub title: String,
  pub detail: Option<String>,
  pub status: String,
  pub priority: i64,
  pub agent_id: Option<String>,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Clone)]
pub enum QueueEvent {
  Updated,
}

#[derive(Debug)]
pub struct QueueStore {
  pool: SqlitePool,
  pub events: broadcast::Sender<QueueEvent>,
}

fn row_to_item(r: &sqlx::sqlite::SqliteRow) -> Option<WorkItem> {
  let id: i64 = r.try_get("id").ok()?;
  let title: String = r.try_get("title").ok()?;
  let detail: Option<String> = r.try_get("detail").ok().flatten();
  let status: String = r.try_get("status").ok()?;
  let priority: i64 = r.try_get("priority").ok()?;
  let agent_id: Option<String> = r.try_get("agent_id").ok().flatten();
  let created_at: String = r.try_get("created_at").ok()?;
  let updated_at: String = r.try_get("updated_at").ok()?;
  Some(WorkItem { id, title, detail, status, priority, agent_id, created_at, updated_at })
}

impl QueueStore {
  pub async fn new(pool: SqlitePool) -> Self {
    let (tx, _rx) = broadcast::channel(64);
    Self { pool, events: tx }
  }

  pub async fn push(&self, title: String, detail: Option<String>, priority: i64, agent_id: Option<String>) -> WorkItem {
    let now = Utc::now().to_rfc3339();
    let result = sqlx::query(
      "INSERT INTO work_items (title, detail, status, priority, agent_id, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?, ?)",
    )
    .bind(&title)
    .bind(&detail)
    .bind(priority)
    .bind(&agent_id)
    .bind(&now)
    .bind(&now)
    .execute(&self.pool)
    .await;

    let id = result.map(|r| r.last_insert_rowid()).unwrap_or(0);
    let item = WorkItem { id, title, detail, status: "pending".into(), priority, agent_id, created_at: now.clone(), updated_at: now };
    let _ = self.events.send(QueueEvent::Updated);
    item
  }

  pub async fn update_status(&self, id: i64, status: String, detail: Option<String>) {
    let now = Utc::now().to_rfc3339();
    if let Some(d) = detail {
      let _ = sqlx::query("UPDATE work_items SET status = ?, detail = ?, updated_at = ? WHERE id = ?")
        .bind(&status).bind(&d).bind(&now).bind(id).execute(&self.pool).await;
    } else {
      let _ = sqlx::query("UPDATE work_items SET status = ?, updated_at = ? WHERE id = ?")
        .bind(&status).bind(&now).bind(id).execute(&self.pool).await;
    }
    let _ = self.events.send(QueueEvent::Updated);
  }

  pub async fn list(&self) -> Vec<WorkItem> {
    sqlx::query(
      "SELECT id, title, detail, status, priority, agent_id, created_at, updated_at \
       FROM work_items ORDER BY status ASC, priority DESC, id ASC",
    )
    .fetch_all(&self.pool)
    .await
    .map(|rows| rows.iter().filter_map(row_to_item).collect())
    .unwrap_or_default()
  }

  pub async fn cancel_pending(&self) {
    let now = Utc::now().to_rfc3339();
    let _ = sqlx::query("UPDATE work_items SET status = 'cancelled', updated_at = ? WHERE status = 'pending'")
      .bind(&now)
      .execute(&self.pool)
      .await;
    let _ = self.events.send(QueueEvent::Updated);
  }
}
