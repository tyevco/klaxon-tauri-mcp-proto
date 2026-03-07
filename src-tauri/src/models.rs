use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KlaxonLevel {
  Info,
  Warning,
  Error,
  Success,
}

impl Default for KlaxonLevel {
  fn default() -> Self {
    Self::Info
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KlaxonStatus {
  Open,
  Answered,
  Dismissed,
  Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldOption {
  pub value: String,
  #[serde(default)]
  pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextValidation {
  #[serde(default)]
  pub min_len: Option<usize>,
  #[serde(default)]
  pub max_len: Option<usize>,
  #[serde(default)]
  pub pattern: Option<String>,
}

fn default_rating_min() -> i32 {
  1
}
fn default_rating_max() -> i32 {
  5
}
fn default_approve_label() -> String {
  "Approve".into()
}
fn default_reject_label() -> String {
  "Reject".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum FormField {
  Text {
    id: String,
    label: String,
    #[serde(default)]
    placeholder: Option<String>,
    #[serde(default)]
    default: Option<String>,
    #[serde(default)]
    validation: Option<TextValidation>,
    #[serde(default)]
    required: bool,
  },
  Textarea {
    id: String,
    label: String,
    #[serde(default)]
    placeholder: Option<String>,
    #[serde(default)]
    default: Option<String>,
    #[serde(default)]
    validation: Option<TextValidation>,
    #[serde(default)]
    required: bool,
  },
  Number {
    id: String,
    label: String,
    #[serde(default)]
    default: Option<f64>,
    #[serde(default)]
    min: Option<f64>,
    #[serde(default)]
    max: Option<f64>,
    #[serde(default)]
    required: bool,
  },
  Select {
    id: String,
    label: String,
    options: Vec<FieldOption>,
    #[serde(default)]
    default: Option<String>,
    #[serde(default)]
    required: bool,
  },
  MultiSelect {
    id: String,
    label: String,
    options: Vec<FieldOption>,
    #[serde(default)]
    default: Vec<String>,
    #[serde(default)]
    required: bool,
  },
  Radio {
    id: String,
    label: String,
    options: Vec<FieldOption>,
    #[serde(default)]
    default: Option<String>,
    #[serde(default)]
    required: bool,
  },
  Checkbox {
    id: String,
    label: String,
    #[serde(default)]
    default: Option<bool>,
    #[serde(default)]
    required: bool,
  },
  Toggle {
    id: String,
    label: String,
    #[serde(default)]
    default: Option<bool>,
    #[serde(default)]
    required: bool,
  },
  Rating {
    id: String,
    label: String,
    #[serde(default)]
    required: bool,
    #[serde(default = "default_rating_min")]
    min: i32,
    #[serde(default = "default_rating_max")]
    max: i32,
    #[serde(default)]
    default: Option<i32>,
  },
  DateTime {
    id: String,
    label: String,
    #[serde(default)]
    default: Option<String>,
    #[serde(default)]
    required: bool,
  },
  IssuePicker {
    id: String,
    label: String,
    #[serde(default)]
    placeholder: Option<String>,
    #[serde(default)]
    default: Option<String>,
    #[serde(default)]
    suggestions: Vec<String>,
    #[serde(default)]
    required: bool,
  },
  DiffApproval {
    id: String,
    label: String,
    diff: String,
    #[serde(default = "default_approve_label")]
    approve_label: String,
    #[serde(default = "default_reject_label")]
    reject_label: String,
    #[serde(default)]
    required: bool,
  },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KlaxonForm {
  pub id: String,
  pub title: String,
  #[serde(default)]
  pub description: String,
  pub fields: Vec<FormField>,
  #[serde(default)]
  pub submit_label: Option<String>,
  #[serde(default)]
  pub cancel_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum KlaxonAction {
  Ack { id: String, label: String },
  OpenUrl { id: String, label: String, url: String },
  RunTool { id: String, label: String, tool: String, arguments: serde_json::Value },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KlaxonItem {
  pub id: Uuid,
  pub level: KlaxonLevel,
  pub title: String,
  pub message: String,
  pub created_at: DateTime<Utc>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub ttl_ms: Option<u64>,
  pub status: KlaxonStatus,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub form: Option<KlaxonForm>,
  #[serde(default)]
  pub actions: Vec<KlaxonAction>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub response: Option<serde_json::Value>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub answered_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KlaxonAnswer {
  pub id: Uuid,
  pub response: serde_json::Value,
}
