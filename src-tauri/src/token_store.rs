use std::{collections::HashMap, path::PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, Mutex};

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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Totals {
  input_tokens: u64,
  output_tokens: u64,
  cost_usd: f64,
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

// Persisted as HashMap<"date|model", Totals>
#[derive(Debug)]
pub struct TokenStore {
  path: PathBuf,
  inner: Mutex<HashMap<(String, String), Totals>>,
  pub events: broadcast::Sender<TokenEvent>,
}

impl TokenStore {
  pub async fn new(path: PathBuf) -> Self {
    let (tx, _rx) = broadcast::channel(64);
    let map = if let Ok(bytes) = tokio::fs::read(&path).await {
      serde_json::from_slice::<HashMap<String, Totals>>(&bytes)
        .map(|m| {
          m.into_iter()
            .map(|(k, v)| {
              let mut parts = k.splitn(2, '|');
              let date = parts.next().unwrap_or("").to_string();
              let model = parts.next().unwrap_or("").to_string();
              ((date, model), v)
            })
            .collect()
        })
        .unwrap_or_default()
    } else {
      HashMap::new()
    };
    Self { path, inner: Mutex::new(map), events: tx }
  }

  async fn persist(&self, map: &HashMap<(String, String), Totals>) {
    let serializable: HashMap<String, &Totals> =
      map.iter().map(|((d, m), v)| (format!("{}|{}", d, m), v)).collect();
    if let Ok(json) = serde_json::to_vec_pretty(&serializable) {
      let _ = tokio::fs::create_dir_all(
        self.path.parent().unwrap_or_else(|| std::path::Path::new(".")),
      )
      .await;
      let _ = tokio::fs::write(&self.path, json).await;
    }
  }

  pub async fn add(&self, delta: TokenDelta) {
    let mut map = self.inner.lock().await;
    let date = Utc::now().format("%Y-%m-%d").to_string();
    let key = (date, delta.model.clone());
    let entry = map.entry(key).or_default();
    entry.input_tokens += delta.input_tokens;
    entry.output_tokens += delta.output_tokens;
    if let Some(cost) = delta.cost_usd {
      entry.cost_usd += cost;
    }
    self.persist(&map).await;
    let _ = self.events.send(TokenEvent::Updated);
  }

  pub async fn today_totals(&self) -> Vec<ModelTotals> {
    let map = self.inner.lock().await;
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let mut out: Vec<ModelTotals> = map
      .iter()
      .filter(|((date, _), _)| date == &today)
      .map(|((_, model), totals)| ModelTotals {
        model: model.clone(),
        input_tokens: totals.input_tokens,
        output_tokens: totals.output_tokens,
        cost_usd: totals.cost_usd,
      })
      .collect();
    out.sort_by(|a, b| b.input_tokens.cmp(&a.input_tokens));
    out
  }
}
