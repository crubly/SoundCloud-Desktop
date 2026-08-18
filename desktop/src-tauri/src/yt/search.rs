//! YouTube search via `yt-dlp ytsearch…` — one flat-playlist JSON dump.
//! Flat entries carry everything the wall tiles need (id, title, duration,
//! channel); thumbnails are derived from the id on the frontend.

use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;

use super::ytdlp::{YtDlp, base_command};

const SEARCH_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YtSearchItem {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
}

pub async fn search(yt: &YtDlp, query: &str, limit: u32) -> Result<Vec<YtSearchItem>, String> {
    let spec = format!("ytsearch{}:{}", limit.clamp(1, 50), query);
    let mut cmd = base_command(yt);
    // Same android player-client as resolve/download — the web client stalls
    // (40s+) or 403s on bot-detected networks.
    cmd.args(["-J", "--flat-playlist", "--no-warnings"])
        .args(["--extractor-args", "youtube:player_client=android", "--"])
        .arg(&spec)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let output = match tokio::time::timeout(SEARCH_TIMEOUT, cmd.output()).await {
        Ok(res) => res.map_err(|e| format!("spawn yt-dlp: {e}"))?,
        Err(_) => return Err("youtube search timed out".to_string()),
    };
    if !output.status.success() {
        return Err(format!("yt-dlp search exit {}", output.status));
    }
    parse_search(&output.stdout)
}

fn parse_search(bytes: &[u8]) -> Result<Vec<YtSearchItem>, String> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| format!("parse yt-dlp json: {e}"))?;
    let entries = value
        .get("entries")
        .and_then(|e| e.as_array())
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        let Some(id) = entry.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(title) = entry.get("title").and_then(|v| v.as_str()) else {
            continue;
        };
        let duration_ms = entry
            .get("duration")
            .and_then(|v| v.as_f64())
            .map(|s| (s * 1000.0).round() as u64);
        let channel = entry
            .get("channel")
            .or_else(|| entry.get("uploader"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let channel_id = entry
            .get("channel_id")
            .or_else(|| entry.get("uploader_id"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        out.push(YtSearchItem {
            id: id.to_string(),
            title: title.to_string(),
            duration_ms,
            channel,
            channel_id,
        });
    }
    Ok(out)
}
