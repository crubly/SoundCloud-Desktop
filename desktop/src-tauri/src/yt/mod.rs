//! YouTube playback support on top of a managed `yt-dlp` binary.
//!
//! Layout: `ytdlp` (binary acquisition), `search` (ytsearch JSON dumps),
//! `resolve` (pasted-link metadata), `download` (bestaudio → MP3 into the
//! shared audio cache). Everything user-facing goes through `commands`.

mod commands;
mod download;
mod resolve;
mod search;
mod ytdlp;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};

use serde_json::json;
use tauri::Emitter;
use tokio::sync::{Mutex, Notify};

pub use commands::*;

/// Minimum progress delta between `track:download-progress` emissions.
const PROGRESS_EMIT_STEP: f64 = 0.02;

#[derive(Clone)]
pub struct YtState {
    /// Shared track-cache audio dir — finished files are committed here under
    /// the `youtube:tracks:<id>` URN filename.
    pub audio_dir: PathBuf,
    /// Scratch dir: the managed yt-dlp binary + in-flight downloads (swept at
    /// startup, so a crash mid-download leaves nothing half-named behind).
    pub work_dir: PathBuf,
    app_handle: Arc<StdMutex<Option<crate::rt::AppHandle>>>,
    /// Cached binary resolution: `None` = not attempted yet, `Some(None)` =
    /// attempted and unavailable (offline / unsupported target).
    binary: Arc<Mutex<Option<Option<ytdlp::YtDlp>>>>,
    /// Single-flight registry for downloads, keyed by video id.
    inflight: Arc<Mutex<HashMap<String, Arc<Notify>>>>,
}

pub fn init(audio_dir: PathBuf, work_dir: PathBuf) -> YtState {
    std::fs::create_dir_all(&work_dir).ok();
    sweep_stale(&work_dir);
    YtState {
        audio_dir,
        work_dir,
        app_handle: Arc::new(StdMutex::new(None)),
        binary: Arc::new(Mutex::new(None)),
        inflight: Arc::new(Mutex::new(HashMap::new())),
    }
}

/// Remove leftovers of an interrupted run: partial downloads and a
/// half-written binary. Finished audio lives outside `work_dir`, untouched.
fn sweep_stale(work_dir: &std::path::Path) {
    let Ok(rd) = std::fs::read_dir(work_dir) else {
        return;
    };
    for entry in rd.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.starts_with("yt_dl_") || name.ends_with(".download") {
            std::fs::remove_file(entry.path()).ok();
        }
    }
}

impl YtState {
    pub fn set_app_handle(&mut self, handle: crate::rt::AppHandle) {
        if let Ok(mut slot) = self.app_handle.lock() {
            *slot = Some(handle);
        }
    }

    /// Resolve (once) the runnable yt-dlp. Warmed in the background at startup,
    /// so the first YouTube search doesn't pay the PATH/download probe.
    pub async fn binary(&self) -> Option<ytdlp::YtDlp> {
        let mut slot = self.binary.lock().await;
        if let Some(cached) = slot.as_ref() {
            return cached.clone();
        }
        let resolved = ytdlp::acquire(&self.work_dir).await;
        *slot = Some(resolved.clone());
        resolved
    }

    pub async fn binary_cached(&self) -> bool {
        matches!(self.binary.lock().await.as_ref(), Some(Some(_)))
    }

    /// Re-download the managed binary after a failure and cache the result.
    pub async fn refresh_binary(&self) -> Option<ytdlp::YtDlp> {
        let mut slot = self.binary.lock().await;
        let fresh = ytdlp::redownload(&self.work_dir).await;
        *slot = Some(fresh.clone());
        fresh
    }

    /// Pipeline stage for the UI: setup → download → convert → done/error.
    pub(crate) fn emit_stage(&self, id: &str, stage: &str) {
        let app = self.app_handle.lock().ok().and_then(|g| g.clone());
        if let Some(app) = app {
            let _ = app.emit("yt:progress", json!({ "id": id, "stage": stage }));
        }
    }

    /// Fill the player's regular download bar for the URN it is waiting on.
    pub(crate) fn emit_download_progress(&self, urn: &str, progress: f64) {
        let app = self.app_handle.lock().ok().and_then(|g| g.clone());
        if let Some(app) = app {
            let _ = app.emit(
                "track:download-progress",
                json!({ "urn": urn, "progress": progress, "source": "youtube" }),
            );
        }
    }
}
