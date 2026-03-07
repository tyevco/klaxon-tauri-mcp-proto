use std::{collections::HashMap, path::PathBuf};

use chrono::Utc;
use tokio::sync::{broadcast, Mutex};
use uuid::Uuid;

use crate::models::{KlaxonItem, KlaxonLevel, KlaxonStatus, KlaxonForm, KlaxonAction};

#[derive(Debug, Clone)]
pub enum StoreEvent {
  Created(KlaxonItem),
  Updated(KlaxonItem),
  Answered { id: Uuid, response: serde_json::Value },
}

#[derive(Debug)]
pub struct KlaxonStore {
  path: PathBuf,
  inner: Mutex<HashMap<Uuid, KlaxonItem>>,
  pub events: broadcast::Sender<StoreEvent>,
}

impl KlaxonStore {
  pub async fn new(path: PathBuf) -> Self {
    let (tx, _rx) = broadcast::channel(256);
    let mut map = HashMap::new();

    if let Ok(bytes) = tokio::fs::read(&path).await {
      if let Ok(items) = serde_json::from_slice::<Vec<KlaxonItem>>(&bytes) {
        for it in items {
          map.insert(it.id, it);
        }
      }
    }

    Self {
      path,
      inner: Mutex::new(map),
      events: tx,
    }
  }

  async fn persist_locked(&self, map: &HashMap<Uuid, KlaxonItem>) {
    let mut v: Vec<KlaxonItem> = map.values().cloned().collect();
    v.sort_by_key(|x| x.created_at);
    if let Ok(json) = serde_json::to_vec_pretty(&v) {
      let _ = tokio::fs::create_dir_all(self.path.parent().unwrap_or_else(|| std::path::Path::new("."))).await;
      let _ = tokio::fs::write(&self.path, json).await;
    }
  }

  pub async fn list_open(&self) -> Vec<KlaxonItem> {
    let mut map = self.inner.lock().await;
    let now = Utc::now();

    // Expire items with TTL (best-effort; runs on reads in the prototype).
    let mut expired_ids: Vec<Uuid> = Vec::new();
    for (id, it) in map.iter() {
      if !matches!(it.status, KlaxonStatus::Open) {
        continue;
      }
      if let Some(ttl) = it.ttl_ms {
        let age_ms = (now - it.created_at).num_milliseconds().max(0) as u64;
        if age_ms >= ttl {
          expired_ids.push(*id);
        }
      }
    }

    for id in expired_ids {
      if let Some(it) = map.get_mut(&id) {
        it.status = KlaxonStatus::Expired;
        let updated = it.clone();
        let _ = self.events.send(StoreEvent::Updated(updated));
      }
    }

    let out = map
      .values()
      .filter(|x| matches!(x.status, KlaxonStatus::Open))
      .cloned()
      .collect();

    self.persist_locked(&map).await;
    out
  }

  pub async fn get(&self, id: Uuid) -> Option<KlaxonItem> {
    let map = self.inner.lock().await;
    map.get(&id).cloned()
  }

  pub async fn get_item(&self, id: Uuid) -> Option<KlaxonItem> {
    let map = self.inner.lock().await;
    map.get(&id).cloned()
  }

  pub async fn get_answer(&self, id: Uuid) -> Option<serde_json::Value> {
    let map = self.inner.lock().await;
    map.get(&id).and_then(|x| x.response.clone())
  }

  pub async fn set_actions(&self, id: Uuid, actions: Vec<KlaxonAction>) -> Option<KlaxonItem> {
    let mut map = self.inner.lock().await;
    let it = map.get_mut(&id)?;
    it.actions = actions;
    let updated = it.clone();
    self.persist_locked(&map).await;
    let _ = self.events.send(StoreEvent::Updated(updated.clone()));
    Some(updated)
  }

  pub async fn notify(&self, level: KlaxonLevel, title: String, message: String, ttl_ms: Option<u64>) -> KlaxonItem {
    let mut map = self.inner.lock().await;
    let item = KlaxonItem {
      id: Uuid::new_v4(),
      level,
      title,
      message,
      created_at: Utc::now(),
      ttl_ms,
      status: KlaxonStatus::Open,
      form: None,
      actions: vec![KlaxonAction::Ack { id: "ack".into(), label: "Acknowledge".into() }],
      response: None,
      answered_at: None,
    };
    map.insert(item.id, item.clone());
    self.persist_locked(&map).await;
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
    let mut map = self.inner.lock().await;
    let item = KlaxonItem {
      id: Uuid::new_v4(),
      level,
      title,
      message,
      created_at: Utc::now(),
      ttl_ms,
      status: KlaxonStatus::Open,
      form: Some(form),
      actions: vec![],
      response: None,
      answered_at: None,
    };
    map.insert(item.id, item.clone());
    self.persist_locked(&map).await;
    let _ = self.events.send(StoreEvent::Created(item.clone()));
    item
  }

  pub async fn ack(&self, id: Uuid) -> Option<KlaxonItem> {
    let mut map = self.inner.lock().await;
    let it = map.get_mut(&id)?;
    // For the prototype, ACK just marks as dismissed for non-form items.
    if it.form.is_none() {
      it.status = KlaxonStatus::Dismissed;
    }
    let updated = it.clone();
    self.persist_locked(&map).await;
    let _ = self.events.send(StoreEvent::Updated(updated.clone()));
    Some(updated)
  }

  pub async fn dismiss(&self, id: Uuid) -> Option<KlaxonItem> {
    let mut map = self.inner.lock().await;
    let it = map.get_mut(&id)?;
    it.status = KlaxonStatus::Dismissed;
    let updated = it.clone();
    self.persist_locked(&map).await;
    let _ = self.events.send(StoreEvent::Updated(updated.clone()));
    Some(updated)
  }

  pub async fn answer(&self, id: Uuid, response: serde_json::Value) -> Option<KlaxonItem> {
    let mut map = self.inner.lock().await;
    let it = map.get_mut(&id)?;
    it.response = Some(response.clone());
    it.status = KlaxonStatus::Answered;
    it.answered_at = Some(Utc::now());
    let updated = it.clone();
    self.persist_locked(&map).await;
    let _ = self.events.send(StoreEvent::Answered { id, response });
    let _ = self.events.send(StoreEvent::Updated(updated.clone()));
    Some(updated)
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::Arc;

  async fn make_store() -> (Arc<KlaxonStore>, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(KlaxonStore::new(dir.path().join("store.json")).await);
    (store, dir)
  }

  #[tokio::test]
  async fn notify_creates_open_item() {
    let (store, _dir) = make_store().await;
    let item = store.notify(KlaxonLevel::Info, "title".into(), "msg".into(), None).await;
    assert!(matches!(item.status, KlaxonStatus::Open));
    let open = store.list_open().await;
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].id, item.id);
  }

  #[tokio::test]
  async fn ack_dismisses_item() {
    let (store, _dir) = make_store().await;
    let item = store.notify(KlaxonLevel::Info, "title".into(), "msg".into(), None).await;
    store.ack(item.id).await;
    assert!(store.list_open().await.is_empty());
  }

  #[tokio::test]
  async fn dismiss_item() {
    let (store, _dir) = make_store().await;
    let item = store.notify(KlaxonLevel::Info, "title".into(), "msg".into(), None).await;
    store.dismiss(item.id).await;
    assert!(store.list_open().await.is_empty());
  }

  #[tokio::test]
  async fn answer_sets_response() {
    let (store, _dir) = make_store().await;
    let form = crate::models::KlaxonForm {
      id: "f1".into(),
      title: "Q".into(),
      description: "".into(),
      fields: vec![],
      submit_label: None,
      cancel_label: None,
    };
    let item = store.ask(KlaxonLevel::Info, "title".into(), "msg".into(), form, None).await;
    let response = serde_json::json!({"answer": "yes"});
    let updated = store.answer(item.id, response.clone()).await.unwrap();
    assert!(matches!(updated.status, KlaxonStatus::Answered));
    assert_eq!(store.get_answer(item.id).await, Some(response));
  }

  #[tokio::test]
  async fn ttl_expiry() {
    let (store, _dir) = make_store().await;
    store.notify(KlaxonLevel::Info, "title".into(), "msg".into(), Some(1)).await;
    tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
    assert!(store.list_open().await.is_empty());
  }

  #[tokio::test]
  async fn persistence_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("store.json");
    let item = {
      let store = KlaxonStore::new(path.clone()).await;
      store.notify(KlaxonLevel::Info, "persistent".into(), "msg".into(), None).await
    };
    let store2 = KlaxonStore::new(path).await;
    let open = store2.list_open().await;
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].id, item.id);
    assert_eq!(open[0].title, "persistent");
  }
}
