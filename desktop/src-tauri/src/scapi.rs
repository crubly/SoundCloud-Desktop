//! SoundCloud-only catalog API layer — no scnative.* hosts are ever contacted.
//!
//! Serves the app's catalog endpoints straight from the public
//! `api-v2.soundcloud.com` using a scraped `client_id` (the same technique as
//! the anonymous track downloader). Collections are wrapped into the paged
//! shape the frontend expects (`{collection, page, page_size, has_more}`);
//! SC-native JSON mostly already matches the app's Track/Playlist/User types.
//!
//! Custom premium-only services that only existed on the old backend
//! (discover, recommendations, lyrics, star, aura, history, events, QR-auth,
//! playlists/likes mutations) have no SoundCloud equivalent and return
//! conservative empty results / 404 instead of pinging dead hosts.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::{Mutex, RwLock};
use warp::Filter;

use crate::app::diagnostics::log_native;
use crate::rt::AppHandle;

const SC_API_V2: &str = "https://api-v2.soundcloud.com";
const SC_WEB: &str = "https://soundcloud.com";
const SC_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const CLIENT_ID_MIN_REFRESH: Duration = Duration::from_secs(30);
/// Circuit breaker: stop hammering SC with a stale client_id after a burst.
const FAIL_THRESHOLD: u8 = 3;
const COOLDOWN_SECS: u64 = 300;

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub struct ScCatalog {
    client: wreq::Client,
    client_id: RwLock<Option<String>>,
    refresh_gate: Mutex<Option<Instant>>,
    fail_count: AtomicU8,
    cooldown_until: std::sync::atomic::AtomicU64,
    app_handle: OnceLock<AppHandle>,
}

impl ScCatalog {
    pub fn new(client: wreq::Client) -> Self {
        Self {
            client,
            client_id: RwLock::new(None),
            refresh_gate: Mutex::new(None),
            fail_count: AtomicU8::new(0),
            cooldown_until: std::sync::atomic::AtomicU64::new(0),
            app_handle: OnceLock::new(),
        }
    }

    pub fn set_app_handle(&self, handle: AppHandle) {
        let _ = self.app_handle.set(handle);
    }

    fn log(&self, level: &str, msg: String) {
        let line = format!("[ScApi] {msg}");
        if let Some(app) = self.app_handle.get() {
            log_native(app, level, &line);
        }
    }

    fn note_success(&self) {
        self.fail_count.store(0, Ordering::Relaxed);
        self.cooldown_until.store(0, Ordering::Relaxed);
    }

    fn note_failure(&self) {
        let count = self.fail_count.fetch_add(1, Ordering::Relaxed) + 1;
        if count >= FAIL_THRESHOLD {
            self.cooldown_until
                .store(now_secs() + COOLDOWN_SECS, Ordering::Relaxed);
            self.fail_count.store(0, Ordering::Relaxed);
            self.log("WARN", format!("circuit open — skipping SC api for {COOLDOWN_SECS}s"));
        }
    }

    fn in_cooldown(&self) -> bool {
        self.cooldown_until.load(Ordering::Relaxed) > now_secs()
    }

    async fn client_id(&self) -> Result<String, String> {
        {
            let cached = self.client_id.read().await;
            if let Some(id) = cached.as_ref() {
                return Ok(id.clone());
            }
        }
        self.refresh_client_id().await
    }

    async fn refresh_client_id(&self) -> Result<String, String> {
        let mut gate = self.refresh_gate.lock().await;
        if let Some(last) = *gate
            && last.elapsed() < CLIENT_ID_MIN_REFRESH
            && let Some(id) = self.client_id.read().await.clone()
        {
            return Ok(id);
        }
        let id = self.fetch_client_id().await?;
        *self.client_id.write().await = Some(id.clone());
        *gate = Some(Instant::now());
        self.log("INFO", "refreshed public SoundCloud client_id".into());
        Ok(id)
    }

    async fn fetch_client_id(&self) -> Result<String, String> {
        let resp = self
            .client
            .get(SC_WEB)
            .header("User-Agent", SC_USER_AGENT)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|e| format!("fetch soundcloud.com: {e}"))?;
        let html = resp
            .text()
            .await
            .map_err(|e| format!("read soundcloud.com body: {e}"))?;
        extract_client_id_from_hydration(&html)
            .ok_or_else(|| "Failed to extract SoundCloud client_id".to_string())
    }

    async fn get_json(&self, url: &str) -> Result<Value, String> {
        let resp = self
            .client
            .get(url)
            .header("User-Agent", SC_USER_AGENT)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|e| format!("request: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(format!("HTTP {status}"));
        }
        resp.json::<Value>()
            .await
            .map_err(|e| format!("decode: {e}"))
    }

    /// Perform a GET against api-v2.soundcloud.com with a fresh `client_id`.
    /// Retries once after refreshing the client_id on failure.
    pub async fn get(&self, path: &str, params: &[(&str, String)]) -> Result<Value, String> {
        if self.in_cooldown() {
            return Err("scapi: circuit open (no client_id)".into());
        }
        let cid = match self.client_id().await {
            Ok(id) => id,
            Err(e) => {
                self.note_failure();
                return Err(e);
            }
        };
        let url = build_sc_url(path, &cid, params);
        match self.get_json(&url).await {
            Ok(v) => {
                self.note_success();
                Ok(v)
            }
            Err(first) => {
                if let Ok(new_id) = self.refresh_client_id().await {
                    let retry = build_sc_url(path, &new_id, params);
                    match self.get_json(&retry).await {
                        Ok(v) => {
                            self.note_success();
                            return Ok(v);
                        }
                        Err(second) => {
                            self.note_failure();
                            return Err(format!("{first}; retry: {second}"));
                        }
                    }
                }
                self.note_failure();
                Err(first)
            }
        }
    }
}

fn build_sc_url(path: &str, client_id: &str, params: &[(&str, String)]) -> String {
    let mut url = format!("{SC_API_V2}{path}?client_id={client_id}");
    for (k, v) in params {
        if !v.is_empty() {
            url.push('&');
            url.push_str(&format!("{k}={}", urlencoding::encode(v)));
        }
    }
    url
}

/// Pull `client_id` out of `window.__sc_hydration` on the SC homepage.
fn extract_client_id_from_hydration(html: &str) -> Option<String> {
    static PATTERN: &str =
        r#""hydratable"\s*:\s*"apiClient"\s*,\s*"data"\s*:\s*\{\s*"id"\s*:\s*"([^"]+)""#;
    let re = regex::Regex::new(PATTERN).ok()?;
    let caps = re.captures(html)?;
    caps.get(1).map(|m| m.as_str().to_string())
}

pub static CATALOG: OnceLock<Arc<ScCatalog>> = OnceLock::new();

// ─── local HTTP surface ─────────────────────────────────────

type ScReply = warp::http::Response<warp::hyper::Body>;

fn ok_json(value: Value) -> ScReply {
    let body = serde_json::to_vec(&value).unwrap_or_default();
    warp::http::Response::builder()
        .status(200)
        .header("Content-Type", "application/json")
        .header("Access-Control-Allow-Origin", "*")
        .body(warp::hyper::Body::from(body))
        .unwrap()
}

fn err_json(status: u16, message: &str) -> ScReply {
    let body = serde_json::to_vec(&json!({ "message": message })).unwrap_or_default();
    warp::http::Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .header("Access-Control-Allow-Origin", "*")
        .body(warp::hyper::Body::from(body))
        .unwrap()
}

/// Wrap an SC collection response (`{collection, next_href, ...}`) into the
/// app's paged shape `{collection, page, page_size, has_more}`.
fn wrap_page(value: Value, page: usize, page_size: usize) -> Value {
    let has_more = value
        .get("next_href")
        .or_else(|| value.get("next_offset"))
        .map(|v| !v.is_null() && v.as_str().map(|s| !s.is_empty()).unwrap_or(true))
        .unwrap_or(false);
    let collection = value.get("collection").cloned().unwrap_or(json!([]));
    json!({
        "collection": collection,
        "page": page,
        "page_size": page_size,
        "has_more": has_more,
    })
}

fn empty_page(page: usize, page_size: usize) -> Value {
    json!({
        "collection": [],
        "page": page,
        "page_size": page_size,
        "has_more": false,
    })
}

fn strip_urn(id: &str) -> String {
    id.rsplit(':').next().unwrap_or(id).to_string()
}

fn page_params(q: &HashMap<String, String>) -> (usize, usize) {
    let page = q
        .get("page")
        .and_then(|p| p.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1);
    let size = q
        .get("page_size")
        .or_else(|| q.get("limit"))
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(50)
        .clamp(1, 200);
    (page, size)
}

async fn route_catalog(c: &ScCatalog, path: &str, q: &HashMap<String, String>) -> Result<Value, String> {
    let trimmed = path.trim_end_matches('/').trim_start_matches('/');
    let segments: Vec<&str> = trimmed.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return Ok(json!({ "ok": true, "service": "scapi" }));
    }

    // Paged collection "home" fetches without q/ids fall through to SC /tracks.
    let (page, size) = page_params(q);

    match segments.as_slice() {
        // ── Tracks ──
        ["tracks"] => {
            if let Some(ids) = q.get("ids").filter(|s| !s.is_empty()) {
                let ids: Vec<String> = ids.split(',').map(strip_urn).collect();
                c.get("/tracks", &[("ids".into(), ids.join(","))]).await
            } else if let Some(query) = q.get("q").filter(|s| !s.is_empty()) {
                let offset = ((page - 1) * size).to_string();
                let v = c
                    .get(
                        "/search/tracks",
                        &[
                            ("q".into(), query.clone()),
                            ("limit".into(), size.to_string()),
                            ("offset".into(), offset),
                            ("linked_partitioning".into(), "true".into()),
                            ("access".into(), "playable".into()),
                        ],
                    )
                    .await?;
                Ok(wrap_page(v, page, size))
            } else {
                let offset = ((page - 1) * size).to_string();
                let v = c
                    .get(
                        "/tracks",
                        &[
                            ("limit".into(), size.to_string()),
                            ("offset".into(), offset),
                            ("linked_partitioning".into(), "true".into()),
                        ],
                    )
                    .await?;
                Ok(v)
            }
        }
        ["tracks", id] => {
            let id = strip_urn(id);
            Ok(c.get(&format!("/tracks/{id}"), &[]).await?)
        }
        ["tracks", id, "related"] => {
            let id = strip_urn(id);
            match c.get(&format!("/tracks/{id}/related"), &[]).await {
                Ok(v) => Ok(v),
                Err(_) => Ok(json!({ "collection": [] })),
            }
        }
        ["tracks", id, "comments"] => {
            let id = strip_urn(id);
            let offset = ((page - 1) * size).to_string();
            let v = c
                .get(
                    &format!("/tracks/{id}/comments"),
                    &[
                        ("limit".into(), size.to_string()),
                        ("offset".into(), offset),
                        ("linked_partitioning".into(), "true".into()),
                    ],
                )
                .await?;
            Ok(wrap_page(v, page, size))
        }
        ["tracks", id, "favoriters"] => {
            let id = strip_urn(id);
            let offset = ((page - 1) * size).to_string();
            let v = c
                .get(
                    &format!("/tracks/{id}/favoriters"),
                    &[
                        ("limit".into(), size.to_string()),
                        ("offset".into(), offset),
                        ("linked_partitioning".into(), "true".into()),
                    ],
                )
                .await?;
            Ok(wrap_page(v, page, size))
        }

        // ── Playlists ──
        ["playlists"] => {
            if let Some(query) = q.get("q").filter(|s| !s.is_empty()) {
                let offset = ((page - 1) * size).to_string();
                let v = c
                    .get(
                        "/search/playlists",
                        &[
                            ("q".into(), query.clone()),
                            ("limit".into(), size.to_string()),
                            ("offset".into(), offset),
                            ("linked_partitioning".into(), "true".into()),
                            ("access".into(), "playable".into()),
                        ],
                    )
                    .await?;
                Ok(wrap_page(v, page, size))
            } else {
                Err("playlists list requires ?q=".into())
            }
        }
        ["playlists", id] => {
            let id = strip_urn(id);
            Ok(c.get(&format!("/playlists/{id}"), &[]).await?)
        }
        ["playlists", id, "tracks"] => {
            let id = strip_urn(id);
            Ok(c.get(&format!("/playlists/{id}"), &[]).await?)
        }

        // ── Users ──
        ["users"] => {
            if let Some(query) = q.get("q").filter(|s| !s.is_empty()) {
                let offset = ((page - 1) * size).to_string();
                let v = c
                    .get(
                        "/search/users",
                        &[
                            ("q".into(), query.clone()),
                            ("limit".into(), size.to_string()),
                            ("offset".into(), offset),
                            ("linked_partitioning".into(), "true".into()),
                        ],
                    )
                    .await?;
                Ok(wrap_page(v, page, size))
            } else {
                Err("users list requires ?q=".into())
            }
        }
        ["users", id] => {
            let id = strip_urn(id);
            Ok(c.get(&format!("/users/{id}"), &[]).await?)
        }
        ["users", id, "tracks"] => {
            let id = strip_urn(id);
            let offset = ((page - 1) * size).to_string();
            let v = c
                .get(
                    &format!("/users/{id}/tracks"),
                    &[
                        ("limit".into(), size.to_string()),
                        ("offset".into(), offset),
                        ("linked_partitioning".into(), "true".into()),
                        ("access".into(), "playable".into()),
                    ],
                )
                .await?;
            Ok(wrap_page(v, page, size))
        }
        ["users", id, "playlists"] => {
            let id = strip_urn(id);
            let offset = ((page - 1) * size).to_string();
            let v = c
                .get(
                    &format!("/users/{id}/playlists"),
                    &[
                        ("limit".into(), size.to_string()),
                        ("offset".into(), offset),
                        ("linked_partitioning".into(), "true".into()),
                    ],
                )
                .await?;
            Ok(wrap_page(v, page, size))
        }
        ["users", id, "likes", "tracks"] | ["users", id, "likes"] => {
            let id = strip_urn(id);
            let offset = ((page - 1) * size).to_string();
            let v = c
                .get(
                    &format!("/users/{id}/likes"),
                    &[
                        ("limit".into(), size.to_string()),
                        ("offset".into(), offset),
                        ("linked_partitioning".into(), "true".into()),
                    ],
                )
                .await?;
            Ok(wrap_page(v, page, size))
        }
        ["users", id, "followings"] => {
            let id = strip_urn(id);
            let offset = ((page - 1) * size).to_string();
            let v = c
                .get(
                    &format!("/users/{id}/followings"),
                    &[
                        ("limit".into(), size.to_string()),
                        ("offset".into(), offset),
                        ("linked_partitioning".into(), "true".into()),
                    ],
                )
                .await?;
            Ok(wrap_page(v, page, size))
        }
        ["users", id, "followers"] => {
            let id = strip_urn(id);
            let offset = ((page - 1) * size).to_string();
            let v = c
                .get(
                    &format!("/users/{id}/followers"),
                    &[
                        ("limit".into(), size.to_string()),
                        ("offset".into(), offset),
                        ("linked_partitioning".into(), "true".into()),
                    ],
                )
                .await?;
            Ok(wrap_page(v, page, size))
        }
        ["users", id, "web-profiles"] => {
            let id = strip_urn(id);
            Ok(c.get(&format!("/users/{id}/web-profiles"), &[]).await?)
        }
        ["users", _id, "aura"] | ["users", _id, "subscription"] => {
            Ok(json!({ "aura_id": null, "custom_hex": null }))
        }

        // ── Resolve ──
        ["resolve"] => {
            if let Some(url) = q.get("url").filter(|s| !s.is_empty()) {
                Ok(c.get("/resolve", &[("url".into(), url.clone())]).await?)
            } else {
                Err("resolve requires ?url=".into())
            }
        }

        // ── Featured ──
        ["featured"] => {
            let offset = ((page - 1) * size).to_string();
            let v = c
                .get(
                    "/featured_tracks/top/all-music",
                    &[
                        ("limit".into(), size.to_string()),
                        ("offset".into(), offset),
                        ("linked_partitioning".into(), "true".into()),
                    ],
                )
                .await?;
            Ok(wrap_page(v, page, size))
        }

        // ── Things that only existed on the old backend ──
        ["likes", "tracks", _id] | ["likes", "playlists", _id] => Ok(json!({ "liked": false })),
        ["dislikes", "status", _id] => Ok(json!({ "status": false })),
        ["artists", _id, "star"] => Ok(json!({ "star": 0 })),
        ["artists", _id, "tracks"] | ["artists", _id, "covers"] => {
            Ok(empty_page(page, size))
        }
        ["recommendations"] => Ok(json!({ "clusters": [] })),
        ["recommendations", "wave", ..] => Ok(json!({ "tracks": [], "cursor": null })),
        ["recommendations", "similar", _id] => Ok(json!({ "clusters": [] })),
        ["search", "db", _item] | ["search", "db", _item, ..] => Ok(empty_page(page, size)),
        ["search", "vibe", ..] => Ok(json!({
            "items": [],
            "atmosphere": { "topGenres": [] },
            "status": "ready"
        })),
        ["search", "lyrics", ..] => Ok(json!({ "hits": [] })),
        ["discover", ..] => Ok(empty_page(page, size)),
        ["indexing", "stats"] => Ok(json!({ "indexed": 0, "pending": 0 })),
        ["history", ..] => Ok(empty_page(page, size)),
        ["events", ..] => Ok(json!({ "ok": true })),
        ["me", ..] | ["auth", ..] | ["subscription", ..] => {
            Err("requires SoundCloud login (not implemented on SoundCloud-only build)".into())
        }

        _ => Err("not found".into()),
    }
}

fn reply_for(result: Result<Value, String>) -> ScReply {
    match result {
        Ok(v) => ok_json(v),
        Err(msg) => {
            if msg == "not found" {
                err_json(404, "not found")
            } else if msg.contains("HTTP 4") {
                err_json(404, &msg)
            } else if msg.starts_with("requires") {
                err_json(401, &msg)
            } else {
                err_json(502, &msg)
            }
        }
    }
}

pub async fn handle(
    full: warp::path::FullPath,
    q: HashMap<String, String>,
) -> Result<ScReply, warp::Rejection> {
    let Some(c) = CATALOG.get() else {
        return Ok(err_json(503, "scapi not ready"));
    };
    let path = full.as_str();
    if path.starts_with("/p/") || path.starts_with("/img/") {
        return Ok(err_json(404, "not found"));
    }
    Ok(reply_for(route_catalog(c, path, &q).await))
}

pub fn routes() -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
    warp::path::full()
        .and(warp::query::<HashMap<String, String>>())
        .and_then(handle)
}