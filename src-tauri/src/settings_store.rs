use sqlx::SqlitePool;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AppSettings {
  pub theme: String,
  pub mcp_preferred_port: u16,
}

impl Default for AppSettings {
  fn default() -> Self {
    Self { theme: "dark".into(), mcp_preferred_port: 0 }
  }
}

#[derive(Debug)]
pub struct SettingsStore {
  pool: SqlitePool,
}

impl SettingsStore {
  pub async fn new(pool: SqlitePool) -> Self {
    Self { pool }
  }

  pub async fn get(&self) -> AppSettings {
    let mut settings = AppSettings::default();
    let rows = sqlx::query("SELECT key, value FROM settings")
      .fetch_all(&self.pool)
      .await
      .unwrap_or_default();

    use sqlx::Row;
    for row in &rows {
      let key: String = row.try_get("key").unwrap_or_default();
      let value: String = row.try_get("value").unwrap_or_default();
      match key.as_str() {
        "theme" => settings.theme = value,
        "mcp_preferred_port" => {
          if let Ok(p) = value.parse::<u16>() {
            settings.mcp_preferred_port = p;
          }
        }
        _ => {}
      }
    }
    settings
  }

  pub async fn set(&self, settings: &AppSettings) {
    let pairs = [
      ("theme", settings.theme.clone()),
      ("mcp_preferred_port", settings.mcp_preferred_port.to_string()),
    ];
    for (key, value) in &pairs {
      let _ = sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .bind(key)
      .bind(value)
      .execute(&self.pool)
      .await;
    }
  }
}
