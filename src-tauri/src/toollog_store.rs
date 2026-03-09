use serde::Serialize;
use std::collections::VecDeque;
use tokio::sync::{broadcast, Mutex};

const MAX_ENTRIES: usize = 200;

#[derive(Debug, Clone, Serialize)]
pub struct ToolCallEntry {
    pub tool: String,
    pub args_summary: String,
    pub duration_ms: u64,
    pub ok: bool,
    pub error: Option<String>,
    pub client_id: String,
    pub called_at: String,
}

#[derive(Debug, Clone)]
pub enum ToolLogEvent {
    Updated,
}

#[derive(Debug)]
pub struct ToolLogStore {
    buffer: Mutex<VecDeque<ToolCallEntry>>,
    pub events: broadcast::Sender<ToolLogEvent>,
}

impl Default for ToolLogStore {
    fn default() -> Self {
        Self::new()
    }
}

impl ToolLogStore {
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(64);
        Self { buffer: Mutex::new(VecDeque::new()), events: tx }
    }

    pub async fn record(&self, entry: ToolCallEntry) {
        let mut buf = self.buffer.lock().await;
        if buf.len() >= MAX_ENTRIES {
            buf.pop_front();
        }
        buf.push_back(entry);
        let _ = self.events.send(ToolLogEvent::Updated);
    }

    pub async fn recent(&self, n: usize) -> Vec<ToolCallEntry> {
        let buf = self.buffer.lock().await;
        let skip = buf.len().saturating_sub(n);
        buf.iter().skip(skip).cloned().collect()
    }

    pub async fn clear(&self) {
        self.buffer.lock().await.clear();
        let _ = self.events.send(ToolLogEvent::Updated);
    }
}
