use chrono::Utc;
use serde::Serialize;
use std::collections::VecDeque;
use tokio::sync::{broadcast, Mutex};

const MAX_LINES: usize = 500;

#[derive(Debug, Clone, Serialize)]
pub struct LogLine {
  pub line: String,
  pub stream: String,
  pub ts: String,
}

#[derive(Debug, Clone)]
pub enum LogTailEvent {
  Updated,
}

#[derive(Debug)]
pub struct LogTailStore {
  buffer: Mutex<VecDeque<LogLine>>,
  pub events: broadcast::Sender<LogTailEvent>,
}

impl LogTailStore {
  pub fn new() -> Self {
    let (tx, _rx) = broadcast::channel(64);
    Self { buffer: Mutex::new(VecDeque::new()), events: tx }
  }

  pub async fn append(&self, lines: Vec<String>, stream: String) {
    let ts = Utc::now().to_rfc3339();
    let mut buf = self.buffer.lock().await;
    for line in lines {
      if buf.len() >= MAX_LINES {
        buf.pop_front();
      }
      buf.push_back(LogLine { line, stream: stream.clone(), ts: ts.clone() });
    }
    let _ = self.events.send(LogTailEvent::Updated);
  }

  pub async fn recent(&self, n: usize, stream: Option<String>) -> Vec<LogLine> {
    let buf = self.buffer.lock().await;
    let filtered: Vec<_> = buf
      .iter()
      .filter(|l| stream.as_ref().map_or(true, |s| &l.stream == s))
      .cloned()
      .collect();
    let skip = filtered.len().saturating_sub(n);
    filtered[skip..].to_vec()
  }

  pub async fn clear(&self) {
    self.buffer.lock().await.clear();
    let _ = self.events.send(LogTailEvent::Updated);
  }
}
