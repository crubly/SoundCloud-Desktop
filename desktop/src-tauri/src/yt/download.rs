//! Download + MP3-convert a YouTube video into the shared audio cache.
//!
//! The finished file lands in the regular track-cache dir under the
//! `youtube:tracks:<id>` URN filename, so it participates in the existing size
//! accounting / eviction / clear tooling untouched, and cache hits are served
//! by the plain track-cache lookup the player already does. Progress mirrors
//! into the player's `track:download-progress` event (the NowPlayingBar bar
//! fills as usual); the conversion phase is signalled via `yt:progress`.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

use super::ytdlp::{YtDlp, base_command};
use super::{PROGRESS_EMIT_STEP, YtState};
use crate::track_cache::urn_to_filename;

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// Files below this are error pages / stubs, not audio (mirrors track_cache).
const MIN_AUDIO_SIZE: u64 = 8192;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YtAudioReady {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

/// YouTube ids are `[A-Za-z0-9_-]{11}`; accept a little slack for future ones.
/// The id lands in a filename, so nothing else may pass.
pub fn video_id_ok(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 20
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn urn_for(id: &str) -> String {
    format!("youtube:tracks:{id}")
}

pub fn cached_path(state: &YtState, id: &str) -> Option<PathBuf> {
    let path = state.audio_dir.join(urn_to_filename(&urn_for(id)));
    match std::fs::metadata(&path) {
        Ok(m) if m.len() >= MIN_AUDIO_SIZE => Some(path),
        _ => None,
    }
}

fn ready(path: PathBuf) -> YtAudioReady {
    YtAudioReady {
        path: path.to_string_lossy().into_owned(),
        duration_ms: None,
    }
}

/// Ensure the MP3 for `id` exists in the audio cache, downloading when needed.
/// Single-flighted per id: a second caller for the same video waits for the
/// first one's cache file instead of starting a parallel download.
pub async fn ensure_audio(
    state: &YtState,
    yt: &YtDlp,
    ffmpeg: Option<PathBuf>,
    id: &str,
) -> Result<YtAudioReady, String> {
    if let Some(path) = cached_path(state, id) {
        return Ok(ready(path));
    }

    let mine = {
        let mut guard = state.inflight.lock().await;
        match guard.get(id) {
            Some(existing) => {
                let existing = existing.clone();
                drop(guard);
                existing.notified().await;
                return cached_path(state, id)
                    .map(ready)
                    .ok_or_else(|| "youtube download failed".to_string());
            }
            None => {
                let notify = std::sync::Arc::new(tokio::sync::Notify::new());
                guard.insert(id.to_string(), notify.clone());
                notify
            }
        }
    };

    let mut current = yt.clone();
    let mut result = run_download(state, &current, ffmpeg.as_deref(), id, None).await;
    // A managed binary that starts failing is most likely just outdated
    // (YouTube changes constantly) — refresh it once and retry before giving up.
    if result.is_err() && current.managed {
        state.emit_stage(id, "setup");
        if let Some(fresh) = state.refresh_binary().await {
            current = fresh;
            result = run_download(state, &current, ffmpeg.as_deref(), id, None).await;
        }
    }
    // Bot-detection (HTTP 403) and DRM-gated videos block the default web
    // client; the `android` player client is far more lenient — retry once with
    // it before surfacing the error to the UI.
    if result.is_err() {
        state.emit_stage(id, "download");
        result = run_download(
            state,
            &current,
            ffmpeg.as_deref(),
            id,
            Some("youtube:player_client=android"),
        )
        .await;
    }

    {
        let mut guard = state.inflight.lock().await;
        guard.remove(id);
    }
    mine.notify_waiters();

    match result {
        Ok(path) => Ok(ready(path)),
        Err(e) => {
            state.emit_stage(id, "error");
            Err(e)
        }
    }
}

async fn run_download(
    state: &YtState,
    yt: &YtDlp,
    ffmpeg: Option<&Path>,
    id: &str,
    extractor_args: Option<&str>,
) -> Result<PathBuf, String> {
    let urn = urn_for(id);
    let final_path = state.audio_dir.join(urn_to_filename(&urn));
    let url = format!("https://www.youtube.com/watch?v={id}");
    let out_tpl = state.work_dir.join(format!("yt_dl_{id}.%(ext)s"));

    state.emit_stage(id, "download");
    let mut cmd = base_command(yt);
    if let Some(args) = extractor_args {
        cmd.arg("--extractor-args").arg(args);
    }
    match ffmpeg {
        // ffmpeg present → canonical path: grab the best audio, convert to MP3.
        Some(bin) => {
            cmd.args(["-f", "bestaudio/best", "-x"])
                .args(["--audio-format", "mp3", "--audio-quality", "192K"]);
            if let Some(dir) = bin.parent() {
                cmd.arg("--ffmpeg-location").arg(dir);
            }
        }
        // No ffmpeg yet (still being fetched on a cold start): take an m4a the
        // engine can decode directly, skip the conversion step.
        None => {
            cmd.args(["-f", "bestaudio[ext=m4a]/bestaudio/best"]);
        }
    }
    cmd.args(["-o"])
        .arg(&out_tpl)
        .args(["--newline", "--no-playlist", "--no-warnings", "--"])
        .arg(&url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let work = async {
        let mut child = cmd.spawn().map_err(|e| format!("spawn yt-dlp: {e}"))?;
        let stdout = child.stdout.take().ok_or("yt-dlp stdout missing")?;
        let stderr = child.stderr.take();
        let stderr_task = tokio::spawn(async move {
            let mut buf = String::new();
            if let Some(mut s) = stderr {
                s.read_to_string(&mut buf).await.ok();
            }
            buf
        });

        let mut lines = BufReader::new(stdout).lines();
        let mut last_emitted = -1.0f64;
        let mut convert_emitted = false;
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if !convert_emitted
                        && (line.starts_with("[ExtractAudio]") || line.starts_with("[Merger]"))
                    {
                        convert_emitted = true;
                        state.emit_stage(id, "convert");
                    }
                    if let Some(pct) = parse_percent(&line) {
                        let progress = (pct / 100.0).clamp(0.0, 1.0);
                        if progress - last_emitted >= PROGRESS_EMIT_STEP {
                            last_emitted = progress;
                            state.emit_download_progress(&urn, progress);
                        }
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = child.kill().await;
                    return Err(format!("yt-dlp output: {e}"));
                }
            }
        }

        let status = child
            .wait()
            .await
            .map_err(|e| format!("yt-dlp wait: {e}"))?;
        let stderr_text = stderr_task.await.unwrap_or_default();
        if !status.success() {
            let tail: String = stderr_text
                .lines()
                .rev()
                .take(2)
                .collect::<Vec<_>>()
                .join(" | ");
            return Err(format!("yt-dlp exit {}: {tail}", status));
        }
        Ok(())
    };

    let result = tokio::time::timeout(DOWNLOAD_TIMEOUT, work)
        .await
        .map_err(|_| "youtube download timed out".to_string())?;

    if let Err(e) = result {
        cleanup_temps(&state.work_dir, id).await;
        return Err(e);
    }

    let Some(produced) = produced_file(&state.work_dir, id).await else {
        cleanup_temps(&state.work_dir, id).await;
        return Err("yt-dlp finished but produced no file".to_string());
    };
    tokio::fs::rename(&produced, &final_path)
        .await
        .map_err(|e| format!("commit youtube audio: {e}"))?;
    cleanup_temps(&state.work_dir, id).await;

    state.emit_download_progress(&urn, 1.0);
    state.emit_stage(id, "done");
    Ok(final_path)
}

/// `[download]  42.1% of …` → 42.1. Tolerant on purpose: yt-dlp's wording has
/// drifted across versions, the percent number hasn't.
fn parse_percent(line: &str) -> Option<f64> {
    if !line.contains("[download]") {
        return None;
    }
    let pct_at = line.find('%')?;
    let before = &line[..pct_at];
    let start = before
        .rfind(|c: char| !(c.is_ascii_digit() || c == '.'))
        .map(|i| i + 1)
        .unwrap_or(0);
    before[start..].trim().parse().ok()
}

/// The file yt-dlp leaves behind for a finished run (`.mp3` after `-x`, or the
/// raw container without ffmpeg). Temps (`.part`, `.ytdl`) are excluded.
async fn produced_file(work_dir: &Path, id: &str) -> Option<PathBuf> {
    let prefix = format!("yt_dl_{id}.");
    let mut rd = tokio::fs::read_dir(work_dir).await.ok()?;
    while let Ok(Some(entry)) = rd.next_entry().await {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.starts_with(&prefix) && !name.ends_with(".part") && !name.ends_with(".ytdl") {
            return Some(entry.path());
        }
    }
    None
}

async fn cleanup_temps(work_dir: &Path, id: &str) {
    let prefix = format!("yt_dl_{id}.");
    if let Ok(mut rd) = tokio::fs::read_dir(work_dir).await {
        while let Ok(Some(entry)) = rd.next_entry().await {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.starts_with(&prefix) {
                tokio::fs::remove_file(entry.path()).await.ok();
            }
        }
    }
}
