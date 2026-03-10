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
fn default_slider_step() -> f64 {
    1.0
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
        required: bool,
        #[serde(default)]
        min_len: Option<usize>,
        #[serde(default)]
        max_len: Option<usize>,
        #[serde(default)]
        pattern: Option<String>,
    },
    Textarea {
        id: String,
        label: String,
        #[serde(default)]
        placeholder: Option<String>,
        #[serde(default)]
        default: Option<String>,
        #[serde(default)]
        required: bool,
        #[serde(default)]
        min_len: Option<usize>,
        #[serde(default)]
        max_len: Option<usize>,
        #[serde(default)]
        pattern: Option<String>,
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
    Slider {
        id: String,
        label: String,
        min: f64,
        max: f64,
        #[serde(default = "default_slider_step")]
        step: f64,
        #[serde(default)]
        default: Option<f64>,
        #[serde(default)]
        required: bool,
    },
    Markdown {
        id: String,
        content: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormBranch {
    pub value: String,
    pub page_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FormPageNext {
    End,
    Fixed {
        page_id: String,
    },
    Conditional {
        field_id: String,
        branches: Vec<FormBranch>,
        #[serde(default)]
        default: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormPage {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    pub fields: Vec<FormField>,
    #[serde(default)]
    pub next: Option<FormPageNext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KlaxonForm {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub fields: Vec<FormField>,
    #[serde(default)]
    pub pages: Vec<FormPage>,
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

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // KlaxonLevel
    // -----------------------------------------------------------------------

    #[test]
    fn level_serializes_lowercase() {
        assert_eq!(serde_json::to_value(KlaxonLevel::Info).unwrap(), "info");
        assert_eq!(serde_json::to_value(KlaxonLevel::Warning).unwrap(), "warning");
        assert_eq!(serde_json::to_value(KlaxonLevel::Error).unwrap(), "error");
        assert_eq!(serde_json::to_value(KlaxonLevel::Success).unwrap(), "success");
    }

    #[test]
    fn level_deserializes_from_lowercase() {
        let level: KlaxonLevel = serde_json::from_value(serde_json::json!("warning")).unwrap();
        assert_eq!(serde_json::to_value(&level).unwrap(), "warning");
    }

    #[test]
    fn level_rejects_unknown_variant() {
        let result = serde_json::from_value::<KlaxonLevel>(serde_json::json!("critical"));
        assert!(result.is_err());
    }

    #[test]
    fn level_default_is_info() {
        let level = KlaxonLevel::default();
        assert_eq!(serde_json::to_value(level).unwrap(), "info");
    }

    // -----------------------------------------------------------------------
    // KlaxonStatus
    // -----------------------------------------------------------------------

    #[test]
    fn status_roundtrips() {
        for (variant, expected) in [
            (KlaxonStatus::Open, "open"),
            (KlaxonStatus::Answered, "answered"),
            (KlaxonStatus::Dismissed, "dismissed"),
            (KlaxonStatus::Expired, "expired"),
        ] {
            let json = serde_json::to_value(&variant).unwrap();
            assert_eq!(json, expected);
            let back: KlaxonStatus = serde_json::from_value(json).unwrap();
            assert_eq!(serde_json::to_value(&back).unwrap(), expected);
        }
    }

    // -----------------------------------------------------------------------
    // FormField discriminated union
    // -----------------------------------------------------------------------

    #[test]
    fn form_field_text_roundtrip() {
        let json = serde_json::json!({
            "type": "text",
            "id": "name",
            "label": "Name",
            "placeholder": "Enter name",
            "required": true,
            "min_len": 1,
            "max_len": 100,
            "pattern": "^[A-Za-z]+$"
        });
        let field: FormField = serde_json::from_value(json.clone()).unwrap();
        match &field {
            FormField::Text { id, label, required, min_len, max_len, pattern, .. } => {
                assert_eq!(id, "name");
                assert_eq!(label, "Name");
                assert!(*required);
                assert_eq!(*min_len, Some(1));
                assert_eq!(*max_len, Some(100));
                assert_eq!(pattern.as_deref(), Some("^[A-Za-z]+$"));
            }
            _ => panic!("expected Text variant"),
        }
        // Roundtrip
        let serialized = serde_json::to_value(&field).unwrap();
        assert_eq!(serialized["type"], "text");
        assert_eq!(serialized["id"], "name");
    }

    #[test]
    fn form_field_number_defaults() {
        let json = serde_json::json!({"type": "number", "id": "age", "label": "Age"});
        let field: FormField = serde_json::from_value(json).unwrap();
        match field {
            FormField::Number { required, min, max, default, .. } => {
                assert!(!required);
                assert!(min.is_none());
                assert!(max.is_none());
                assert!(default.is_none());
            }
            _ => panic!("expected Number variant"),
        }
    }

    #[test]
    fn form_field_rating_defaults() {
        let json = serde_json::json!({"type": "rating", "id": "r", "label": "Rate"});
        let field: FormField = serde_json::from_value(json).unwrap();
        match field {
            FormField::Rating { min, max, .. } => {
                assert_eq!(min, 1);
                assert_eq!(max, 5);
            }
            _ => panic!("expected Rating variant"),
        }
    }

    #[test]
    fn form_field_slider_step_default() {
        let json = serde_json::json!({
            "type": "slider", "id": "s", "label": "Slide", "min": 0.0, "max": 10.0
        });
        let field: FormField = serde_json::from_value(json).unwrap();
        match field {
            FormField::Slider { step, .. } => assert!((step - 1.0).abs() < f64::EPSILON),
            _ => panic!("expected Slider variant"),
        }
    }

    #[test]
    fn form_field_diff_approval_defaults() {
        let json = serde_json::json!({
            "type": "diffapproval", "id": "d", "label": "Review", "diff": "+ added line"
        });
        let field: FormField = serde_json::from_value(json).unwrap();
        match field {
            FormField::DiffApproval { approve_label, reject_label, .. } => {
                assert_eq!(approve_label, "Approve");
                assert_eq!(reject_label, "Reject");
            }
            _ => panic!("expected DiffApproval variant"),
        }
    }

    #[test]
    fn form_field_rejects_unknown_type() {
        let json = serde_json::json!({"type": "unknown_type", "id": "x", "label": "X"});
        assert!(serde_json::from_value::<FormField>(json).is_err());
    }

    // -----------------------------------------------------------------------
    // KlaxonAction discriminated union
    // -----------------------------------------------------------------------

    #[test]
    fn action_ack_roundtrip() {
        let json = serde_json::json!({"kind": "ack", "id": "a1", "label": "OK"});
        let action: KlaxonAction = serde_json::from_value(json).unwrap();
        match &action {
            KlaxonAction::Ack { id, label } => {
                assert_eq!(id, "a1");
                assert_eq!(label, "OK");
            }
            _ => panic!("expected Ack"),
        }
        let back = serde_json::to_value(&action).unwrap();
        assert_eq!(back["kind"], "ack");
    }

    #[test]
    fn action_open_url_roundtrip() {
        let json = serde_json::json!({
            "kind": "open_url", "id": "o1", "label": "Open", "url": "https://example.com"
        });
        let action: KlaxonAction = serde_json::from_value(json).unwrap();
        match &action {
            KlaxonAction::OpenUrl { url, .. } => assert_eq!(url, "https://example.com"),
            _ => panic!("expected OpenUrl"),
        }
    }

    #[test]
    fn action_run_tool_roundtrip() {
        let json = serde_json::json!({
            "kind": "run_tool", "id": "r1", "label": "Run", "tool": "my_tool",
            "arguments": {"key": "value"}
        });
        let action: KlaxonAction = serde_json::from_value(json).unwrap();
        match &action {
            KlaxonAction::RunTool { tool, arguments, .. } => {
                assert_eq!(tool, "my_tool");
                assert_eq!(arguments["key"], "value");
            }
            _ => panic!("expected RunTool"),
        }
    }

    // -----------------------------------------------------------------------
    // FormPageNext
    // -----------------------------------------------------------------------

    #[test]
    fn form_page_next_end() {
        let json = serde_json::json!({"kind": "end"});
        let next: FormPageNext = serde_json::from_value(json).unwrap();
        match next {
            FormPageNext::End => {}
            _ => panic!("expected End"),
        }
    }

    #[test]
    fn form_page_next_fixed() {
        let json = serde_json::json!({"kind": "fixed", "page_id": "p2"});
        let next: FormPageNext = serde_json::from_value(json).unwrap();
        match next {
            FormPageNext::Fixed { page_id } => assert_eq!(page_id, "p2"),
            _ => panic!("expected Fixed"),
        }
    }

    #[test]
    fn form_page_next_conditional() {
        let json = serde_json::json!({
            "kind": "conditional",
            "field_id": "answer",
            "branches": [{"value": "yes", "page_id": "p2"}],
            "default": "p3"
        });
        let next: FormPageNext = serde_json::from_value(json).unwrap();
        match next {
            FormPageNext::Conditional { field_id, branches, default } => {
                assert_eq!(field_id, "answer");
                assert_eq!(branches.len(), 1);
                assert_eq!(branches[0].value, "yes");
                assert_eq!(branches[0].page_id, "p2");
                assert_eq!(default, Some("p3".to_string()));
            }
            _ => panic!("expected Conditional"),
        }
    }

    // -----------------------------------------------------------------------
    // KlaxonForm
    // -----------------------------------------------------------------------

    #[test]
    fn form_minimal() {
        let json = serde_json::json!({
            "id": "f1",
            "title": "My Form",
            "fields": []
        });
        let form: KlaxonForm = serde_json::from_value(json).unwrap();
        assert_eq!(form.id, "f1");
        assert_eq!(form.title, "My Form");
        assert!(form.description.is_empty());
        assert!(form.fields.is_empty());
        assert!(form.pages.is_empty());
        assert!(form.submit_label.is_none());
        assert!(form.cancel_label.is_none());
    }

    #[test]
    fn form_with_pages() {
        let json = serde_json::json!({
            "id": "f1",
            "title": "Multi-page",
            "fields": [],
            "pages": [
                {
                    "id": "p1",
                    "title": "Page 1",
                    "fields": [{"type": "text", "id": "q1", "label": "Q1"}],
                    "next": {"kind": "fixed", "page_id": "p2"}
                },
                {
                    "id": "p2",
                    "fields": [{"type": "text", "id": "q2", "label": "Q2"}],
                    "next": {"kind": "end"}
                }
            ]
        });
        let form: KlaxonForm = serde_json::from_value(json).unwrap();
        assert_eq!(form.pages.len(), 2);
        assert_eq!(form.pages[0].id, "p1");
        assert!(form.pages[0].next.is_some());
    }

    // -----------------------------------------------------------------------
    // KlaxonItem serialization
    // -----------------------------------------------------------------------

    #[test]
    fn item_skips_none_fields_in_serialization() {
        let item = KlaxonItem {
            id: Uuid::nil(),
            level: KlaxonLevel::Info,
            title: "Test".into(),
            message: "msg".into(),
            created_at: chrono::Utc::now(),
            ttl_ms: None,
            status: KlaxonStatus::Open,
            form: None,
            actions: vec![],
            response: None,
            answered_at: None,
        };
        let json = serde_json::to_value(&item).unwrap();
        assert!(json.get("ttl_ms").is_none(), "ttl_ms should be omitted when None");
        assert!(json.get("form").is_none(), "form should be omitted when None");
        assert!(json.get("response").is_none(), "response should be omitted when None");
        assert!(json.get("answered_at").is_none(), "answered_at should be omitted when None");
    }

    #[test]
    fn item_includes_fields_when_present() {
        let item = KlaxonItem {
            id: Uuid::nil(),
            level: KlaxonLevel::Warning,
            title: "Test".into(),
            message: "msg".into(),
            created_at: chrono::Utc::now(),
            ttl_ms: Some(5000),
            status: KlaxonStatus::Open,
            form: Some(KlaxonForm {
                id: "f1".into(),
                title: "Form".into(),
                description: String::new(),
                fields: vec![],
                pages: vec![],
                submit_label: None,
                cancel_label: None,
            }),
            actions: vec![KlaxonAction::Ack { id: "a1".into(), label: "OK".into() }],
            response: None,
            answered_at: None,
        };
        let json = serde_json::to_value(&item).unwrap();
        assert_eq!(json["ttl_ms"], 5000);
        assert_eq!(json["form"]["id"], "f1");
        assert_eq!(json["actions"][0]["kind"], "ack");
    }
}
