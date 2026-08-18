//! Single-URL metadata resolve (a pasted YouTube link) via `yt-dlp -J`.

use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;

use super::ytdlp::{YtDlp, base_command};

const RESOLVE_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YtVideoMeta {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    pub thumbnail: String,
    pub url: String,
}

/// Host gate: only YouTube-ish URLs are ever handed to yt-dlp — the search
/// field is free text, and yt-dlp would happily run any of its 1000+
/// extractors on an arbitrary link.
pub fn is_youtube_url(raw: &str) -> bool {
    let Ok(url) = url::Url::parse(raw.trim()) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.strip_prefix("www.").unwrap_or(host);
    host == "youtu.be"
        || host == "youtube.com"
        || host == "youtube-nocookie.com"
        || host.ends_with(".youtube.com")
        || host.ends_with(".youtube-nocookie.com")
}

pub async fn resolve(yt: &YtDlp, url: &str) -> Result<YtVideoMeta, String> {
    if !is_youtube_url(url) {
        return Err("not a youtube url".to_string());
    }
    let mut cmd = base_command(yt);
    // The `android` player client avoids YouTube bot-detection stalls (the
    // default web client can take 40+ seconds or fail with HTTP 403 on some
    // networks) — metadata comes back in a couple of seconds.
    cmd.args(["-J", "--no-playlist", "--no-warnings"])
        .args(["--extractor-args", "youtube:player_client=android", "--"])
        .arg(url)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let output = match tokio::time::timeout(RESOLVE_TIMEOUT, cmd.output()).await {
        Ok(res) => res.map_err(|e| format!("spawn yt-dlp: {e}"))?,
        Err(_) => return Err("youtube resolve timed out".to_string()),
    };
    if !output.status.success() {
        return Err(format!("yt-dlp resolve exit {}", output.status));
    }

    let value: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("parse yt-dlp json: {e}"))?;
    let id = value
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("resolve: no video id")?;
    let title = value
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or(id)
        .to_string();
    let duration_ms = value
        .get("duration")
        .and_then(|v| v.as_f64())
        .map(|s| (s * 1000.0).round() as u64);
    let channel = value
        .get("channel")
        .or_else(|| value.get("uploader"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let channel_id = value
        .get("channel_id")
        .or_else(|| value.get("uploader_id"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    // Thumbnails arrive ascending — the last one is the largest. Fall back to
    // the canonical hqdefault, which always exists.
    let thumbnail = value
        .get("thumbnails")
        .and_then(|t| t.as_array())
        .and_then(|list| {
            list.iter()
                .filter_map(|t| t.get("url").and_then(|u| u.as_str()))
                .last()
        })
        .map(str::to_string)
        .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"));
    Ok(YtVideoMeta {
        id: id.to_string(),
        title,
        duration_ms,
        channel,
        channel_id,
        thumbnail,
        url: format!("https://www.youtube.com/watch?v={id}"),
    })
}
