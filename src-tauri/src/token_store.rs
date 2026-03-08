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

#[derive(Debug, Clone, Serialize)]
pub struct DayTotals {
  pub date: String,
  pub cost_usd: f64,
  pub input_tokens: u64,
  pub output_tokens: u64,
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

  pub async fn week_totals(&self) -> Vec<DayTotals> {
    let rows = sqlx::query(
      "SELECT date, SUM(cost_usd) as total_cost, SUM(input_tokens) as total_input, SUM(output_tokens) as total_output \
       FROM token_entries \
       WHERE date >= date('now', '-6 days') \
       GROUP BY date \
       ORDER BY date ASC",
    )
    .fetch_all(&self.pool)
    .await
    .unwrap_or_default();

    rows.iter()
      .filter_map(|r| {
        let date: String = r.try_get("date").ok()?;
        let cost_usd: f64 = r.try_get("total_cost").ok()?;
        let input: i64 = r.try_get("total_input").ok()?;
        let output: i64 = r.try_get("total_output").ok()?;
        Some(DayTotals { date, cost_usd, input_tokens: input as u64, output_tokens: output as u64 })
      })
      .collect()
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
