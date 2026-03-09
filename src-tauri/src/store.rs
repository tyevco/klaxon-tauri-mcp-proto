use chrono::Utc;
use sqlx::{Row, SqlitePool};
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::models::{KlaxonAction, KlaxonForm, KlaxonItem, KlaxonLevel, KlaxonStatus};

#[derive(Debug, Clone)]
pub enum StoreEvent {
    Created(KlaxonItem),
    Updated(KlaxonItem),
    Answered { id: Uuid, response: serde_json::Value },
}

#[derive(Debug)]
pub struct KlaxonStore {
    pool: SqlitePool,
    pub events: broadcast::Sender<StoreEvent>,
}

fn level_str(level: &KlaxonLevel) -> &'static str {
    match level {
        KlaxonLevel::Info => "info",
        KlaxonLevel::Warning => "warning",
        KlaxonLevel::Error => "error",
        KlaxonLevel::Success => "success",
    }
}

fn row_to_item(row: &sqlx::sqlite::SqliteRow) -> KlaxonItem {
    let id_str: String = row.try_get("id").unwrap_or_default();
    let level_str: String = row.try_get("level").unwrap_or_else(|_| "info".into());
    let title: String = row.try_get("title").unwrap_or_default();
    let message: String = row.try_get("message").unwrap_or_default();
    let created_at_str: String = row.try_get("created_at").unwrap_or_default();
    let ttl_ms: Option<i64> = row.try_get("ttl_ms").unwrap_or(None);
    let status_str: String = row.try_get("status").unwrap_or_else(|_| "open".into());
    let form_json: Option<String> = row.try_get("form").unwrap_or(None);
    let actions_json: Option<String> = row.try_get("actions").unwrap_or(None);
    let response_json: Option<String> = row.try_get("response").unwrap_or(None);
    let answered_at_str: Option<String> = row.try_get("answered_at").unwrap_or(None);

    let id = Uuid::parse_str(&id_str).unwrap_or_else(|_| Uuid::new_v4());
    let level: KlaxonLevel =
        serde_json::from_value(serde_json::Value::String(level_str)).unwrap_or_default();
    let status: KlaxonStatus =
        serde_json::from_value(serde_json::Value::String(status_str)).unwrap_or(KlaxonStatus::Open);
    let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());
    let form: Option<KlaxonForm> = form_json.as_deref().and_then(|s| serde_json::from_str(s).ok());
    let actions: Vec<KlaxonAction> =
        actions_json.as_deref().and_then(|s| serde_json::from_str(s).ok()).unwrap_or_default();
    let response: Option<serde_json::Value> =
        response_json.as_deref().and_then(|s| serde_json::from_str(s).ok());
    let answered_at = answered_at_str
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc)));

    KlaxonItem {
        id,
        level,
        title,
        message,
        created_at,
        ttl_ms: ttl_ms.map(|v| v as u64),
        status,
        form,
        actions,
        response,
        answered_at,
    }
}

impl KlaxonStore {
    pub async fn new(pool: SqlitePool) -> Self {
        let (tx, _rx) = broadcast::channel(256);
        Self { pool, events: tx }
    }

    pub async fn list_open(&self) -> Vec<KlaxonItem> {
        // Expire items whose TTL has elapsed
        let _ = sqlx::query(
      "UPDATE klaxon_items SET status = 'expired' \
       WHERE status = 'open' AND ttl_ms IS NOT NULL \
       AND (CAST(strftime('%s', 'now') AS INTEGER) - CAST(strftime('%s', created_at) AS INTEGER)) * 1000 >= ttl_ms"
    )
    .execute(&self.pool)
    .await;

        sqlx::query("SELECT * FROM klaxon_items WHERE status = 'open' ORDER BY created_at ASC")
            .fetch_all(&self.pool)
            .await
            .map(|rows| rows.iter().map(row_to_item).collect())
            .unwrap_or_default()
    }

    pub async fn list_all(&self, limit: i64, offset: i64) -> Vec<KlaxonItem> {
        // Expire items whose TTL has elapsed
        let _ = sqlx::query(
      "UPDATE klaxon_items SET status = 'expired' \
       WHERE status = 'open' AND ttl_ms IS NOT NULL \
       AND (CAST(strftime('%s', 'now') AS INTEGER) - CAST(strftime('%s', created_at) AS INTEGER)) * 1000 >= ttl_ms"
    )
    .execute(&self.pool)
    .await;

        sqlx::query("SELECT * FROM klaxon_items ORDER BY created_at DESC LIMIT ? OFFSET ?")
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map(|rows| rows.iter().map(row_to_item).collect())
            .unwrap_or_default()
    }

    pub async fn get(&self, id: Uuid) -> Option<KlaxonItem> {
        self.get_item(id).await
    }

    pub async fn get_item(&self, id: Uuid) -> Option<KlaxonItem> {
        sqlx::query("SELECT * FROM klaxon_items WHERE id = ?")
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await
            .ok()
            .flatten()
            .map(|row| row_to_item(&row))
    }

    pub async fn get_answer(&self, id: Uuid) -> Option<serde_json::Value> {
        self.get_item(id).await.and_then(|it| it.response)
    }

    pub async fn set_actions(&self, id: Uuid, actions: Vec<KlaxonAction>) -> Option<KlaxonItem> {
        let actions_json = serde_json::to_string(&actions).ok()?;
        sqlx::query("UPDATE klaxon_items SET actions = ? WHERE id = ?")
            .bind(&actions_json)
            .bind(id.to_string())
            .execute(&self.pool)
            .await
            .ok()?;
        let item = self.get_item(id).await?;
        let _ = self.events.send(StoreEvent::Updated(item.clone()));
        Some(item)
    }

    pub async fn notify(
        &self,
        level: KlaxonLevel,
        title: String,
        message: String,
        ttl_ms: Option<u64>,
    ) -> KlaxonItem {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let actions = vec![KlaxonAction::Ack { id: "ack".into(), label: "Acknowledge".into() }];
        let actions_json = serde_json::to_string(&actions).unwrap_or_else(|_| "[]".into());

        let _ = sqlx::query(
      "INSERT INTO klaxon_items (id, level, title, message, created_at, ttl_ms, status, actions) \
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)",
    )
    .bind(id.to_string())
    .bind(level_str(&level))
    .bind(&title)
    .bind(&message)
    .bind(now.to_rfc3339())
    .bind(ttl_ms.map(|v| v as i64))
    .bind(&actions_json)
    .execute(&self.pool)
    .await;

        let item = KlaxonItem {
            id,
            level,
            title,
            message,
            created_at: now,
            ttl_ms,
            status: KlaxonStatus::Open,
            form: None,
            actions,
            response: None,
            answered_at: None,
        };
        let _ = self.events.send(StoreEvent::Created(item.clone()));
        item
    }

    pub async fn ask(
        &self,
        level: KlaxonLevel,
        title: String,
        message: String,
        form: KlaxonForm,
        ttl_ms: Option<u64>,
    ) -> KlaxonItem {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let form_json = serde_json::to_string(&form).unwrap_or_default();

        let _ = sqlx::query(
      "INSERT INTO klaxon_items (id, level, title, message, created_at, ttl_ms, status, form, actions) \
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, '[]')",
    )
    .bind(id.to_string())
    .bind(level_str(&level))
    .bind(&title)
    .bind(&message)
    .bind(now.to_rfc3339())
    .bind(ttl_ms.map(|v| v as i64))
    .bind(&form_json)
    .execute(&self.pool)
    .await;

        let item = KlaxonItem {
            id,
            level,
            title,
            message,
            created_at: now,
            ttl_ms,
            status: KlaxonStatus::Open,
            form: Some(form),
            actions: vec![],
            response: None,
            answered_at: None,
        };
        let _ = self.events.send(StoreEvent::Created(item.clone()));
        item
    }

    pub async fn ack(&self, id: Uuid) -> Option<KlaxonItem> {
        let item = self.get_item(id).await?;
        if item.form.is_none() {
            let _ = sqlx::query("UPDATE klaxon_items SET status = 'dismissed' WHERE id = ?")
                .bind(id.to_string())
                .execute(&self.pool)
                .await;
        }
        let updated = self.get_item(id).await?;
        let _ = self.events.send(StoreEvent::Updated(updated.clone()));
        Some(updated)
    }

    pub async fn dismiss(&self, id: Uuid) -> Option<KlaxonItem> {
        let _ = sqlx::query("UPDATE klaxon_items SET status = 'dismissed' WHERE id = ?")
            .bind(id.to_string())
            .execute(&self.pool)
            .await;
        let updated = self.get_item(id).await?;
        let _ = self.events.send(StoreEvent::Updated(updated.clone()));
        Some(updated)
    }

    pub async fn list_answered(&self, limit: i64) -> Vec<KlaxonItem> {
        sqlx::query(
      "SELECT * FROM klaxon_items WHERE status = 'answered' ORDER BY answered_at DESC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(&self.pool)
    .await
    .map(|rows| rows.iter().map(row_to_item).collect())
    .unwrap_or_default()
    }

    pub async fn answer(&self, id: Uuid, response: serde_json::Value) -> Option<KlaxonItem> {
        let response_json = serde_json::to_string(&response).ok()?;
        let now = Utc::now().to_rfc3339();
        let _ = sqlx::query(
      "UPDATE klaxon_items SET status = 'answered', response = ?, answered_at = ? WHERE id = ?",
    )
    .bind(&response_json)
    .bind(&now)
    .bind(id.to_string())
    .execute(&self.pool)
    .await;

        let _ = self.events.send(StoreEvent::Answered { id, response });
        let updated = self.get_item(id).await?;
        let _ = self.events.send(StoreEvent::Updated(updated.clone()));
        Some(updated)
    }
}
