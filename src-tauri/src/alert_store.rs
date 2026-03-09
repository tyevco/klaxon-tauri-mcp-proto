use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRule {
    pub id: i64,
    pub kind: String,
    pub threshold: f64,
    pub level: String,
    pub message: String,
    pub enabled: bool,
    pub last_fired_at: Option<String>,
}

#[derive(Debug, Clone)]
pub enum AlertEvent {
    Updated,
}

#[derive(Debug)]
pub struct AlertStore {
    pool: SqlitePool,
    pub events: broadcast::Sender<AlertEvent>,
}

fn row_to_rule(r: &sqlx::sqlite::SqliteRow) -> Option<AlertRule> {
    let id: i64 = r.try_get("id").ok()?;
    let kind: String = r.try_get("kind").ok()?;
    let threshold: f64 = r.try_get("threshold").ok()?;
    let level: String = r.try_get("level").ok()?;
    let message: String = r.try_get("message").ok()?;
    let enabled: i64 = r.try_get("enabled").ok()?;
    let last_fired_at: Option<String> = r.try_get("last_fired_at").ok().flatten();
    Some(AlertRule { id, kind, threshold, level, message, enabled: enabled != 0, last_fired_at })
}

impl AlertStore {
    pub async fn new(pool: SqlitePool) -> Self {
        let (tx, _rx) = broadcast::channel(64);
        Self { pool, events: tx }
    }

    pub async fn list(&self) -> Vec<AlertRule> {
        sqlx::query("SELECT id, kind, threshold, level, message, enabled, last_fired_at FROM alert_rules ORDER BY id ASC")
      .fetch_all(&self.pool)
      .await
      .map(|rows| rows.iter().filter_map(row_to_rule).collect())
      .unwrap_or_default()
    }

    pub async fn create(
        &self,
        kind: String,
        threshold: f64,
        level: String,
        message: String,
    ) -> AlertRule {
        let result = sqlx::query(
      "INSERT INTO alert_rules (kind, threshold, level, message, enabled) VALUES (?, ?, ?, ?, 1)",
    )
    .bind(&kind)
    .bind(threshold)
    .bind(&level)
    .bind(&message)
    .execute(&self.pool)
    .await;

        let id = result.map(|r| r.last_insert_rowid()).unwrap_or(0);
        let rule =
            AlertRule { id, kind, threshold, level, message, enabled: true, last_fired_at: None };
        let _ = self.events.send(AlertEvent::Updated);
        rule
    }

    pub async fn update(
        &self,
        id: i64,
        kind: String,
        threshold: f64,
        level: String,
        message: String,
        enabled: bool,
    ) {
        let _ = sqlx::query(
      "UPDATE alert_rules SET kind = ?, threshold = ?, level = ?, message = ?, enabled = ? WHERE id = ?",
    )
    .bind(&kind)
    .bind(threshold)
    .bind(&level)
    .bind(&message)
    .bind(enabled as i64)
    .bind(id)
    .execute(&self.pool)
    .await;
        let _ = self.events.send(AlertEvent::Updated);
    }

    pub async fn delete(&self, id: i64) {
        let _ =
            sqlx::query("DELETE FROM alert_rules WHERE id = ?").bind(id).execute(&self.pool).await;
        let _ = self.events.send(AlertEvent::Updated);
    }

    pub async fn mark_fired(&self, id: i64) {
        let now = Utc::now().to_rfc3339();
        let _ = sqlx::query("UPDATE alert_rules SET last_fired_at = ? WHERE id = ?")
            .bind(&now)
            .bind(id)
            .execute(&self.pool)
            .await;
        let _ = self.events.send(AlertEvent::Updated);
    }
}
