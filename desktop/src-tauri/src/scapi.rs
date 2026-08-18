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

/// Open lyrics source — no key, CORS-open, returns LRC + plain text.
/// Matches the app's `BackendLyricsResponse` shape 1:1.
const LRCLIB_API: &str = "https://lrclib.net/api";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const CLIENT_ID_MIN_REFRESH: Duration = Duration::from_secs(30);
/// Circuit breaker: stop hammering SC with a stale client_id after a burst.
const FAIL_THRESHOLD: u8 = 3;
const COOLDOWN_SECS: u64 = 300;
/// How long a fetched playlist detail can back the paged `/playlists/{id}/tracks`.
const PLAYLIST_CACHE_TTL: Duration = Duration::from_secs(120);

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
    playlist_cache: Mutex<HashMap<String, (Instant, Value)>>,
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
            playlist_cache: Mutex::new(HashMap::new()),
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
                // Definitive client error (404/400/…) — SoundCloud is fine, there's
                // just nothing here. Don't burn a client_id refresh and DON'T trip
                // the circuit breaker on it (that was opening the breaker over
                // "no comments"/"no favoriters" and 502-ing the whole app).
                if let Some(status) = http_status_of(&first)
                    && (400..500).contains(&status)
                {
                    return Err(first);
                }
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

/// Pull `HTTP <status>` out of a `get_json` error string (e.g. "HTTP 404"),
/// so callers can distinguish definitive 4xx client errors from 5xx/network.
fn http_status_of(err: &str) -> Option<u16> {
    let rest = err.strip_prefix("HTTP ")?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

impl ScCatalog {
    /// SC playlist detail, cached briefly so the paged `/playlists/{id}/tracks`
    /// slice doesn't refetch the whole set on every page.
    async fn playlist(&self, id: &str) -> Result<Value, String> {
        {
            let guard = self.playlist_cache.lock().await;
            if let Some((at, value)) = guard.get(id)
                && at.elapsed() < PLAYLIST_CACHE_TTL
            {
                return Ok(value.clone());
            }
        }
        let value = self.get(&format!("/playlists/{id}"), &[]).await?;
        self.playlist_cache
            .lock()
            .await
            .insert(id.to_string(), (Instant::now(), value.clone()));
        Ok(value)
    }
}

/// Map an LRCLIB result onto the app's `BackendLyricsResponse` shape.
fn lyrics_from_lrclib(value: &Value) -> Value {
    json!({
        "scTrackId": "",
        "syncedLrc": value.get("syncedLyrics").and_then(|v| v.as_str()).map(str::to_string),
        "plainText": value.get("plainLyrics").and_then(|v| v.as_str()).map(str::to_string),
        "source": "lrclib",
        "language": value.get("language").and_then(|v| v.as_str()).map(str::to_string),
        "languageConfidence": value.get("languageConfidence").and_then(|v| v.as_f64()),
    })
}

impl ScCatalog {
    /// Fetch lyrics from the open LRCLIB API (LRC + plain text). Returns the
    /// `none` shape when nothing is found so the frontend renders its
    /// "not found" panel instead of surfacing error toasts.
    async fn lyrics(&self, artist: &str, title: &str, duration_ms: Option<u64>) -> Result<Value, String> {
        let artist = artist.trim();
        let title = title.trim();
        if artist.is_empty() || title.is_empty() {
            return Ok(lyrics_none());
        }
        let duration_secs = duration_ms.map(|ms| (ms / 1000).max(1));

        // Exact hit: artist + title + duration.
        if let Some(secs) = duration_secs {
            let url = format!(
                "{LRCLIB_API}/get?artist_name={}&track_name={}&duration={}",
                urlencoding::encode(artist),
                urlencoding::encode(title),
                secs
            );
            if let Ok(v) = self.fetch_lrclib(&url).await {
                return Ok(lyrics_from_lrclib(&v));
            }
        }

        // Fallback: search and take the first result.
        let url = format!(
            "{LRCLIB_API}/search?artist_name={}&track_name={}",
            urlencoding::encode(artist),
            urlencoding::encode(title)
        );
        let v = self.fetch_lrclib(&url).await?;
        let first = v
            .as_array()
            .and_then(|a| a.first())
            .cloned()
            .unwrap_or_default();
        Ok(lyrics_from_lrclib(&first))
    }

    async fn fetch_lrclib(&self, url: &str) -> Result<Value, String> {
        let resp = self
            .client
            .get(url)
            .header("User-Agent", SC_USER_AGENT)
            .header("Accept", "application/json")
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|e| format!("lrclib request: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(format!("lrclib HTTP {status}"));
        }
        resp.json::<Value>()
            .await
            .map_err(|e| format!("lrclib decode: {e}"))
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

/// Minimal local user shape so artist pages degrade gracefully when SoundCloud
/// is unreachable instead of surfacing an error.
fn default_user() -> Value {
    json!({
        "id": null,
        "kind": "user",
        "urn": "",
        "username": "",
        "full_name": "",
        "permalink": "",
        "permalink_url": null,
        "avatar_url": null,
        "description": null,
        "country": null,
        "city": null,
        "website": null,
        "followers_count": 0,
        "followings_count": 0,
        "track_count": 0,
        "playlist_count": 0,
        "likes_count": 0,
        "verified": false,
        "created_at": null,
        "web_profiles": [],
    })
}

fn default_playlist() -> Value {
    json!({
        "id": null,
        "kind": "playlist",
        "urn": "",
        "title": "",
        "description": null,
        "artwork_url": null,
        "duration": 0,
        "track_count": 0,
        "tracks": [],
        "user": default_user(),
        "permalink_url": null,
        "created_at": null,
        "release_date": null,
        "display_date": null,
        "genre": "",
        "tag_list": "",
        "likes_count": 0,
        "playback_count": 0,
        "public": true,
        "sharing": "public",
    })
}

/// Лирики на SoundCloud-only билде нет — фронт ловит `result null` и не
/// показывает панель. Отдаём 200, чтобы не сыпались error-тосты.
fn lyrics_none() -> Value {
    json!({
        "scTrackId": "",
        "syncedLrc": null,
        "plainText": null,
        "source": "none",
        "language": null,
    })
}

fn strip_urn(id: &str) -> String {
    id.rsplit(':').next().unwrap_or(id).to_string()
}

/// SC titles often lead with "<artist> - <title>"; LRCLIB indexes the clean
/// title, so drop the artist prefix when it matches the resolved artist.
fn strip_artist_prefix(title: &str, artist: &str) -> String {
    let t = title.trim();
    let a = artist.trim();
    if a.is_empty() {
        return t.to_string();
    }
    for sep in [" - ", " – "] {
        let prefix = format!("{a}{sep}");
        if let Some(rest) = t.strip_prefix(&prefix) {
            let rest = rest.trim();
            if !rest.is_empty() {
                return rest.to_string();
            }
        }
    }
    t.to_string()
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
                .await;
            // SC 4xx on comments (disabled/no comments) is a normal outcome.
            match v {
                Ok(v) => Ok(wrap_page(v, page, size)),
                Err(_) => Ok(empty_page(page, size)),
            }
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
                .await;
            match v {
                Ok(v) => Ok(wrap_page(v, page, size)),
                Err(_) => Ok(empty_page(page, size)),
            }
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
            // SC отдаёт весь set одним разом — пейджим локально из кеша.
            let playlist = c.playlist(&id).await?;
            let all = playlist
                .get("tracks")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let offset = (page - 1) * size;
            let slice: Vec<Value> = all.iter().skip(offset).take(size).cloned().collect();
            let has_more = offset + slice.len() < all.len();
            Ok(json!({
                "collection": slice,
                "page": page,
                "page_size": size,
                "has_more": has_more,
            }))
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
        ["users", _id, "followings", _target] => Ok(json!({ "following": false })),
        ["users", _id, "aura"] => Ok(json!({ "aura_id": null, "custom_hex": null })),
        ["users", _id, "subscription"] => Ok(json!({ "premium": false })),

        // ── Artists (SC users — albums/covers have no cheap SC equivalent) ──
        ["artists", id] => {
            let id = strip_urn(id);
            match c.get(&format!("/users/{id}"), &[]).await {
                Ok(v) => Ok(v),
                Err(_) => Ok(default_user()),
            }
        }
        ["artists", id, "tracks"] => {
            let id = strip_urn(id);
            let offset = ((page - 1) * size).to_string();
            match c
                .get(
                    &format!("/users/{id}/tracks"),
                    &[
                        ("limit".into(), size.to_string()),
                        ("offset".into(), offset),
                        ("linked_partitioning".into(), "true".into()),
                        ("access".into(), "playable".into()),
                    ],
                )
                .await
            {
                Ok(v) => Ok(wrap_page(v, page, size)),
                Err(_) => Ok(empty_page(page, size)),
            }
        }
        ["artists", _id, "albums"] => Ok(json!([])),
        ["artists", _id, "covers"] => Ok(empty_page(page, size)),
        ["artists", _id, "star"] => Ok(json!({ "star": 0 })),

        // ── Albums (SC playlists with kind=album) ──
        ["albums", id] => {
            let id = strip_urn(id);
            match c.get(&format!("/playlists/{id}"), &[]).await {
                Ok(v) => Ok(v),
                Err(_) => Ok(default_playlist()),
            }
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
            // Трендовый чарт SC → hero-карточка приложения (FeaturedResponse).
            let v = c
                .get(
                    "/charts",
                    &[
                        ("kind".into(), "trending".into()),
                        ("genre".into(), "soundcloud:genres:all-music".into()),
                        ("limit".into(), "1".into()),
                        ("linked_partitioning".into(), "true".into()),
                    ],
                )
                .await?;
            let data = v
                .get("collection")
                .and_then(|c| c.as_array())
                .and_then(|a| a.first())
                // /charts кладёт элементы как {score, track} — hero нужен сам трек.
                .and_then(|item| item.get("track").or(Some(item)))
                .cloned();
            Ok(json!({ "type": "track", "data": data }))
        }

        // ── Things that only existed on the old backend ──
        ["likes", "tracks", _id] | ["likes", "playlists", _id] => Ok(json!({ "liked": false })),
        ["dislikes", "status", _id] => Ok(json!({ "disliked": false })),
        ["dislikes", "ids"] => Ok(json!({ "ids": [] })),
        ["dislikes", _id] => Ok(json!({ "ok": true })),
        ["recommendations"] => Ok(json!({ "clusters": [] })),
        ["recommendations", "wave", ..] => Ok(json!({ "tracks": [], "cursor": null })),
        ["recommendations", "similar", _id] => Ok(json!({ "clusters": [] })),
        ["recommendations", "feedback"] => Ok(json!({ "ok": true })),
        ["search", "db", _item] | ["search", "db", _item, ..] => Ok(empty_page(page, size)),
        ["search", "vibe", ..] => Ok(json!({
            "items": [],
            "atmosphere": { "topGenres": [] },
            "status": "ready"
        })),
        ["search", "lyrics", ..] | ["lyrics", "search"] => {
            let artist = q.get("artist").cloned().unwrap_or_default();
            let title = q.get("title").cloned().unwrap_or_default();
            let duration = q.get("duration").and_then(|v| v.parse::<u64>().ok());
            Ok(c.lyrics(&artist, &title, duration).await?)
        }
        ["lyrics", id] => {
            let id = strip_urn(id);
            // SC track lookup may legitimately fail (or the breaker be open) —
            // degrade to a 200 "none" instead of 502 so the lyrics pane shows
            // its "not found" state rather than an error toast.
            let track = match c.get(&format!("/tracks/{id}"), &[]).await {
                Ok(t) => t,
                Err(_) => {
                    let mut none = lyrics_none();
                    none["scTrackId"] = json!(id);
                    return Ok(none);
                }
            };
            let artist = track
                .get("user")
                .and_then(|u| u.get("username"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .or_else(|| {
                    track
                        .get("publisher_metadata")
                        .and_then(|m| m.get("artist"))
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                })
                .unwrap_or_default();
            let raw_title = track
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let title = strip_artist_prefix(raw_title, &artist);
            let duration = track.get("duration").and_then(|v| v.as_u64());
            let mut result = c.lyrics(&artist, &title, duration).await.unwrap_or_else(|_| lyrics_none());
            result["scTrackId"] = json!(id);
            Ok(result)
        }
        ["tracks", _id, "sharing"] | ["playlists", _id, "sharing"] => Ok(json!({ "ok": true })),
        ["discover", ..] => Ok(empty_page(page, size)),
        ["indexing", "stats"] => Ok(json!({ "indexed": 0, "pending": 0 })),
        ["history", ..] => Ok(empty_page(page, size)),
        ["events", ..] => Ok(json!({ "ok": true })),

        // ── "My" endpoints — no SoundCloud session on this build; return local
        //    empties so the UI renders gracefully instead of spamming 401s. ──
        ["me", "playlists"]
        | ["me", "likes", "playlists"]
        | ["me", "likes", "tracks"]
        | ["me", "followings"]
        | ["me", "followings", "tracks"] => Ok(empty_page(page, size)),
        ["me", "followings", _id] => Ok(json!({ "following": false })),
        ["me", "aura"] => Ok(json!({ "aura_id": null, "custom_hex": null })),
        ["me", "subscription"] => Ok(json!({ "premium": false })),
        ["me", "cold"] => Ok(json!({ "id": null, "username": null })),
        ["auth", ..] => Ok(json!({ "authenticated": false })),
        ["subscription", ..] => Ok(json!({ "premium": false })),
        ["me", ..] => Ok(json!({})),

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