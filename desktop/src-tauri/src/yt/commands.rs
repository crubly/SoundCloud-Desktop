use tauri::State;

use super::download::{YtAudioReady, ensure_audio, video_id_ok};
use super::resolve::YtVideoMeta;
use super::search::YtSearchItem;
use super::YtState;
use crate::track_cache::TrackCacheState;

const DEFAULT_SEARCH_LIMIT: u32 = 24;

/// A runnable yt-dlp, self-healing: the background warmup at startup can race
/// the proxy stack being ready and cache a `None` — so a None from `binary()`
/// is retried once through `refresh_binary()` instead of treated as permanent.
async fn runnable(state: &YtState) -> Result<super::ytdlp::YtDlp, String> {
    if let Some(yt) = state.binary().await {
        return Ok(yt);
    }
    state
        .refresh_binary()
        .await
        .ok_or_else(|| "yt-dlp unavailable".to_string())
}

#[tauri::command]
pub async fn yt_search(
    query: String,
    limit: Option<u32>,
    state: State<'_, YtState>,
) -> Result<Vec<YtSearchItem>, String> {
    let query = query.trim();
    if query.len() < 2 {
        return Ok(Vec::new());
    }
    let yt = runnable(&state).await?;
    super::search::search(&yt, query, limit.unwrap_or(DEFAULT_SEARCH_LIMIT)).await
}

#[tauri::command]
pub async fn yt_resolve(url: String, state: State<'_, YtState>) -> Result<YtVideoMeta, String> {
    let yt = runnable(&state).await?;
    super::resolve::resolve(&yt, url.trim()).await
}

/// Blocking "make it playable" — downloads + converts on a miss, instant on a
/// cache hit. The player awaits this before `audio_load_file`, exactly like the
/// SoundCloud `track_ensure_cached` path.
#[tauri::command]
pub async fn yt_ensure_audio(
    id: String,
    state: State<'_, YtState>,
    cache: State<'_, TrackCacheState>,
) -> Result<YtAudioReady, String> {
    if !video_id_ok(&id) {
        return Err("bad video id".to_string());
    }
    if !state.binary_cached().await {
        state.emit_stage(&id, "setup");
    }
    let yt = runnable(&state).await?;
    ensure_audio(&state, &yt, cache.ffmpeg_path(), &id).await
}
