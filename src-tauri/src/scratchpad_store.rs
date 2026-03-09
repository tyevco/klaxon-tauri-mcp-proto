use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScratchpadEntry {
    pub id: i64,
    pub content: String,
    pub author: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub enum ScratchpadEvent {
    Updated,
}

#[derive(Debug)]
pub struct ScratchpadStore {
    pool: SqlitePool,
    pub events: broadcast::Sender<ScratchpadEvent>,
}

impl ScratchpadStore {
    pub async fn new(pool: SqlitePool) -> Self {
        let (tx, _rx) = broadcast::channel(64);
        Self { pool, events: tx }
    }

    pub async fn add(&self, content: String, author: String) -> ScratchpadEntry {
        let now = Utc::now().to_rfc3339();
        let result = sqlx::query(
            "INSERT INTO scratchpad_entries (content, author, created_at) VALUES (?, ?, ?)",
        )
        .bind(&content)
        .bind(&author)
        .bind(&now)
        .execute(&self.pool)
        .await;

        let id = result.map(|r| r.last_insert_rowid()).unwrap_or(0);
        let entry = ScratchpadEntry { id, content, author, created_at: now };
        let _ = self.events.send(ScratchpadEvent::Updated);
        entry
    }

    pub async fn list(&self, limit: i64) -> Vec<ScratchpadEntry> {
        let rows = sqlx::query(
      "SELECT id, content, author, created_at FROM scratchpad_entries ORDER BY id DESC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(&self.pool)
    .await
    .unwrap_or_default();

        // Return in chronological order (oldest first = chat log style)
        let mut entries: Vec<ScratchpadEntry> = rows
            .iter()
            .filter_map(|r| {
                let id: i64 = r.try_get("id").ok()?;
                let content: String = r.try_get("content").ok()?;
                let author: String = r.try_get("author").ok()?;
                let created_at: String = r.try_get("created_at").ok()?;
                Some(ScratchpadEntry { id, content, author, created_at })
            })
            .collect();
        entries.reverse();
        entries
    }

    pub async fn clear(&self) {
        let _ = sqlx::query("DELETE FROM scratchpad_entries").execute(&self.pool).await;
        let _ = self.events.send(ScratchpadEvent::Updated);
    }
}
