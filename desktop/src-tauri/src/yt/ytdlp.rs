//! Managed `yt-dlp` binary acquisition.
//!
//! Resolution order: a system `yt-dlp` on PATH (best — the user keeps it
//! current), then a previously downloaded binary in `work_dir`, then a fresh
//! download from the official GitHub releases. A downloaded binary is
//! exec-tested (`--version`) before it is trusted, so a wrong-arch or
//! truncated download is discarded instead of poisoning the cache.
//!
//! On macOS the official `yt-dlp_macos` (a self-contained Python app) can take
//! ~12s of dyld/amfid validation per exec — so when a Python >= 3.10 is
//! available we prefer the plain zipapp run through it (sub-second startup).

use std::path::{Path, PathBuf};
use std::process::Stdio;

use futures_util::StreamExt;
use tokio::process::Command;

/// A runnable yt-dlp. `managed` marks the binary we downloaded ourselves (and
/// may therefore re-download when it starts failing); a PATH binary belongs to
/// the user and is never touched. `python` is set when `path` is a plain
/// zipapp that must be executed via an interpreter.
#[derive(Clone)]
pub struct YtDlp {
    pub path: PathBuf,
    pub managed: bool,
    pub python: Option<PathBuf>,
}

const RELEASE_BASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

fn bin_name() -> &'static str {
    if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" }
}

/// Candidates probed for a Python >= 3.10 (macOS). The system `/usr/bin/python3`
/// is 3.9 and unsupported by current yt-dlp, so it is not listed.
const PYTHON_CANDIDATES: &[&str] = &[
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/opt/homebrew/bin/python3.14",
    "/opt/homebrew/bin/python3.13",
    "/opt/homebrew/bin/python3.12",
    "/opt/homebrew/bin/python3.11",
    "/usr/local/bin/python3.14",
    "/usr/local/bin/python3.13",
    "/usr/local/bin/python3.12",
    "/usr/local/bin/python3.11",
];

async fn python_version_ok(path: &Path) -> bool {
    let output = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await;
    // Homebrew prints to stdout, but probe once more via an actual run in the
    // parent; here a successful exit is a strong enough signal.
    matches!(output, Ok(s) if s.success())
}

/// Find a Python >= 3.10 to run the plain zipapp. Probed candidates only — a
/// PATH `python3` could be the 3.9 system one, so we don't trust it blindly.
async fn find_python() -> Option<PathBuf> {
    for cand in PYTHON_CANDIDATES {
        let path = PathBuf::from(cand);
        if path.is_file() && python_version_ok(&path).await {
            return Some(path);
        }
    }
    None
}

/// (asset, python) — which release asset to fetch and whether the result needs
/// an interpreter. On macOS a suitable Python makes the plain zipapp usable,
/// which starts far faster than the embedded `yt-dlp_macos`.
async fn download_asset() -> Option<(&'static str, Option<PathBuf>)> {
    if cfg!(windows) {
        return Some(("yt-dlp.exe", None));
    }
    if cfg!(target_os = "macos") {
        if let Some(py) = find_python().await {
            return Some(("yt-dlp", Some(py)));
        }
        return Some(("yt-dlp_macos", None));
    }
    if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        return Some(("yt-dlp_linux_aarch64", None));
    }
    if cfg!(target_os = "linux") {
        return Some(("yt-dlp_linux", None));
    }
    None
}

/// yt-dlp invocation with our defaults: no console window on Windows, no stdin
/// (a stray read would hang the app). Runs `python <path> …` when the binary is
/// a zipapp.
pub fn base_command(yt: &YtDlp) -> Command {
    let mut cmd = match &yt.python {
        Some(py) => Command::new(py),
        None => Command::new(&yt.path),
    };
    if yt.python.is_some() {
        cmd.arg(&yt.path);
    }
    cmd.stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// A plain `--version` run — probes both system and downloaded binaries.
async fn runs(yt: &YtDlp) -> bool {
    matches!(
        base_command(yt)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await,
        Ok(status) if status.success()
    )
}

/// Resolve a runnable yt-dlp. `None` when offline or on an unsupported target —
/// callers surface a "component unavailable" error to the UI.
pub async fn acquire(work_dir: &Path) -> Option<YtDlp> {
    let system = YtDlp {
        path: PathBuf::from(bin_name()),
        managed: false,
        python: None,
    };
    if runs(&system).await {
        return Some(system);
    }
    let bundled_path = work_dir.join(bin_name());
    let bundled = YtDlp {
        path: bundled_path.clone(),
        managed: true,
        // A previously saved zipapp needs a python; re-probing is cheap and the
        // result is cached in YtState anyway.
        python: find_python().await,
    };
    if bundled_path.is_file() && runs(&bundled).await {
        return Some(bundled);
    }
    download(work_dir).await
}

/// Force re-download of the managed binary — a one-shot self-heal when a
/// previously working yt-dlp starts failing on YouTube-side changes.
pub async fn redownload(work_dir: &Path) -> Option<YtDlp> {
    let bundled = work_dir.join(bin_name());
    tokio::fs::remove_file(&bundled).await.ok();
    download(work_dir).await
}

async fn download(work_dir: &Path) -> Option<YtDlp> {
    let (asset, python) = download_asset().await?;
    // GitHub "latest" releases 302-redirect to the tagged asset, but the shared
    // fingerprint client does not follow redirects (SC CDNs don't need them) —
    // so chase the Location chain manually (bounded) before streaming the body.
    let client = crate::network::proxy::STATE.get()?.http_client.clone();
    tokio::fs::create_dir_all(work_dir).await.ok()?;
    let target = work_dir.join(bin_name());
    let tmp = work_dir.join(format!("{}.download", bin_name()));

    let fetched: Result<(), String> = async {
        use tokio::io::AsyncWriteExt;
        let mut url = format!("{RELEASE_BASE}/{asset}");
        let mut response = None;
        for _ in 0..10 {
            let res = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("yt-dlp download: {e}"))?;
            let code = res.status().as_u16();
            if (300..400).contains(&code) {
                let Some(location) = res.headers().get("location").and_then(|v| v.to_str().ok()) else {
                    return Err(format!("yt-dlp download: redirect at {code}"));
                };
                url = if location.starts_with("http://") || location.starts_with("https://") {
                    location.to_string()
                } else {
                    // Relative Location (rare) — resolve against the base root.
                    format!("https://github.com{location}")
                };
                continue;
            }
            response = Some(res);
            break;
        }
        let response = response.ok_or("yt-dlp download: too many redirects")?;
        if !response.status().is_success() {
            return Err(format!("yt-dlp download: HTTP {}", response.status()));
        }
        let mut file = tokio::fs::File::create(&tmp)
            .await
            .map_err(|e| format!("yt-dlp download: create: {e}"))?;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("yt-dlp download: body: {e}"))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("yt-dlp download: write: {e}"))?;
        }
        file.flush()
            .await
            .map_err(|e| format!("yt-dlp download: flush: {e}"))?;
        drop(file);
        tokio::fs::rename(&tmp, &target)
            .await
            .map_err(|e| format!("yt-dlp download: commit: {e}"))?;
        Ok(())
    }
    .await;

    if let Err(e) = fetched {
        eprintln!("[yt] {e}");
        tokio::fs::remove_file(&tmp).await.ok();
        return None;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&target) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&target, perms).ok();
        }
    }

    let candidate = YtDlp {
        path: target,
        managed: true,
        python,
    };
    if runs(&candidate).await {
        Some(candidate)
    } else {
        eprintln!("[yt] downloaded yt-dlp does not run — discarding");
        tokio::fs::remove_file(&candidate.path).await.ok();
        None
    }
}
