use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenDelta {
  pub model: String,
  pub input_tokens: u64,
  pub output_tokens: u64,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub cost_usd: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelTotals {
  pub model: String,
  pub input_tokens: u64,
  pub output_tokens: u64,
  pub cost_usd: f64,
}

#[derive(Debug, Clone)]
pub enum TokenEvent {
  Updated,
}

#[derive(Debug)]
pub struct TokenStore {
  pool: SqlitePool,
  pub events: broadcast::Sender<TokenEvent>,
}

impl TokenStore {
  pub async fn new(pool: SqlitePool) -> Self {
    let (tx, _rx) = broadcast::channel(64);
    Self { pool, events: tx }
  }

  pub async fn add(&self, delta: TokenDelta) {
    let date = Utc::now().format("%Y-%m-%d").to_string();
    let cost = delta.cost_usd.unwrap_or(0.0);
    let _ = sqlx::query(
      "INSERT INTO token_entries (date, model, input_tokens, output_tokens, cost_usd) \
       VALUES (?, ?, ?, ?, ?) \
       ON CONFLICT(date, model) DO UPDATE SET \
         input_tokens  = input_tokens  + excluded.input_tokens, \
         output_tokens = output_tokens + excluded.output_tokens, \
         cost_usd      = cost_usd      + excluded.cost_usd",
    )
    .bind(&date)
    .bind(&delta.model)
    .bind(delta.input_tokens as i64)
    .bind(delta.output_tokens as i64)
    .bind(cost)
    .execute(&self.pool)
    .await;

    let _ = self.events.send(TokenEvent::Updated);
  }

  pub async fn today_totals(&self) -> Vec<ModelTotals> {
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let rows = sqlx::query(
      "SELECT model, input_tokens, output_tokens, cost_usd FROM token_entries WHERE date = ? ORDER BY input_tokens DESC",
    )
    .bind(&today)
    .fetch_all(&self.pool)
    .await
    .unwrap_or_default();

    rows.iter()
      .filter_map(|r| {
        let model: String = r.try_get("model").ok()?;
        let input_tokens: i64 = r.try_get("input_tokens").ok()?;
        let output_tokens: i64 = r.try_get("output_tokens").ok()?;
        let cost_usd: f64 = r.try_get("cost_usd").ok()?;
        Some(ModelTotals {
          model,
          input_tokens: input_tokens as u64,
          output_tokens: output_tokens as u64,
          cost_usd,
        })
      })
      .collect()
  }
}
