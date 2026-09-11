//! macOS Touch Bar: live karaoke lyrics + track info + cover art + transport.
//!
//! AppKit objects are main-thread-only, so they are created and touched
//! exclusively on the main thread via `run_on_main_thread` from small
//! refresher/action threads. Playhead/metadata/lyrics arrive cross-thread into
//! a plain `BarState` guard; the refresher coalesces changes and pushes the
//! minimum diff to the AppKit controls.
//!
//! The full implementation lives in the macOS-only `detail` module; on other
//! platforms the public entry points are no-ops so callers stay cfg-free.

/// When the Touch Bar should be shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TouchBarMode {
    /// Only while a SoundCloud window is active.
    Active,
    /// Always, even when the window is minimized/hidden.
    Always,
    /// Present the strip as a **system-modal** touch bar via the public
    /// `+[NSTouchBar presentSystemModalTouchBar:systemTrayItemIdentifier:]`
    /// (macOS 10.14+): it stays visible over *every* application until the
    /// user dismisses it (tap the tray button, the close control macOS draws
    /// while SoundCloud is frontmost, or Esc).
    Overall,
}

impl Default for TouchBarMode {
    fn default() -> Self {
        TouchBarMode::Always
    }
}

/// The configurable touch-bar elements. `Cover`, `Info` and `Lyrics` collapse
/// into a single clustered item (`Main`) so the cover/name/karaoke always stay
/// adjacent on the strip; only `Prev`/`Play`/`Next` are free-standing items.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TouchBarElement {
    Cover,
    Info,
    Lyrics,
    Main,
    Prev,
    Play,
    Next,
}

impl TouchBarElement {
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "cover" => Some(Self::Cover),
            "info" => Some(Self::Info),
            "lyrics" => Some(Self::Lyrics),
            "prev" => Some(Self::Prev),
            "play" => Some(Self::Play),
            "next" => Some(Self::Next),
            _ => None,
        }
    }
}

/// Full touch-bar preference, decoded from the settings tab.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TouchBarConfig {
    pub mode: TouchBarMode,
    pub elements: Vec<String>,
    pub lyrics_always: bool,
}

#[cfg(target_os = "macos")]
mod detail {
    use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
    use std::sync::{mpsc, LazyLock, Mutex, OnceLock};
    use std::time::Duration;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, Sel};
    use objc2::{define_class, msg_send, sel, AnyThread, ClassType, MainThreadOnly, MainThreadMarker};
use objc2_app_kit::{
        NSAttributedStringNSStringDrawing, NSAnimationContext, NSApplication, NSBaselineOffsetAttributeName, NSBezierPath,
        NSButtonTouchBarItem, NSClipView, NSCustomTouchBarItem, NSFontAttributeName,
        NSForegroundColorAttributeName, NSImage, NSImageView, NSImageScaling, NSLayoutAttribute,
        NSLineBreakMode, NSStackView, NSTextAlignment, NSTextField, NSTouchBar, NSTouchBarItem,
        NSTouchBarItemIdentifier, NSUserInterfaceLayoutOrientation, NSView, NSWindow,
    };
    use objc2_foundation::{
        NSPoint, NSArray, NSData, NSMutableAttributedString, NSNumber, NSRange, NSRect, NSSet,
        NSSize, NSString,
    };
    use tauri::{Emitter, Manager};

    use crate::app::diagnostics::log_native;
    use crate::rt::AppHandle;
    use super::{TouchBarConfig, TouchBarElement, TouchBarMode};

    // Layout constants for the clustered main item: cover → info → lyrics.
    const COVER_SIZE: f64 = 36.0;
    const INFO_WIDTH: f64 = 180.0;
    /// Base width of the karaoke viewport when no transport buttons are shown;
    /// each enabled transport item (Prev/Play/Next) reclaims a slice so the
    /// strip never slides underneath the buttons.
    const LYRICS_WIDTH_BASE: f64 = 420.0;
    const TRANSPORT_ITEM_WIDTH: f64 = 60.0;
    const MIN_LYRICS_WIDTH: f64 = 150.0;
    /// Extra margin carved off the lyrics viewport in the system-modal mode:
    /// macOS draws a "close" control at the bar's right edge there, so the
    /// strip needs a little more headroom to never touch it.
    const MODAL_MARGIN: f64 = 45.0;
    const CLUSTER_HEIGHT: f64 = 24.0;
    const CLUSTER_GAP: f64 = 9.0;
    const COVER_RADIUS: f64 = 7.0;
    /// Fixed width of the karaoke label's backing frame. It is never resized
    /// during playback (resizing every 100 ms is what made the field flicker);
    /// the narrow clip window scrolls within it. Long lines scroll left and
    /// vanish at the margins.
    const LYRICS_TEXT_MAX_WIDTH: f64 = 1600.0;
    /// Item identifier of the dismiss button used for the system-modal bar
    /// (`Overall` mode). It lives only in `templateItems` (never in the default
    /// strip) and doubles as the Control Strip tray item.
    const MODAL_TRAY_ID: &str = "scModalTray";

    // -----------------------------------------------------------------------
    // Selectors fired by the transport buttons; mirrored onto the same `media:*`
    // events the OS Now Playing controls already emit, so the frontend keeps one
    // handling path.
    // -----------------------------------------------------------------------
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum TouchBarAction {
        PlayPause,
        Prev,
        Next,
    }

    /// Cross-thread state mutated by the audio pipeline / settings commands.
    #[derive(Debug, Default)]
    struct BarState {
        enabled: bool,
        /// Whether the bar is attached to the main window.
        attached: bool,
        /// Whether the bar is attached at the app level (Always/Overall).
        app_attached: bool,
        /// Whether the strip is currently up as a system-modal touch bar
        /// (`Overall` mode). Once presented it stays until the user dismisses
        /// it; only a mode/toggle transition re-presents it.
        modal_presented: bool,
        title: String,
        artist: String,
        /// `encoded` payload of the cover (the `scproxy://.../img/<encoded>` tail).
        cover_encoded: Option<String>,
        /// Monotonic generation for cover fetches; 0 = no cover.
        cover_gen: u64,
        playing: bool,
        lyrics: String,
        /// Filled fraction of the current line, 0.0..=1.0.
        fraction: f32,
        mode: TouchBarMode,
        elements: Vec<TouchBarElement>,
        lyrics_always: bool,
        /// Set when the track changes so the strip hard-clears until the new
        /// track's timeline delivers its first real lyric line.
        lyrics_reset: bool,
    }

    /// Main-thread snapshot of what is already applied to the AppKit controls.
    #[derive(Debug, Clone, Default)]
    struct AppliedUi {
        title: String,
        artist: String,
/// The currently displayed (partially lit) lyric substring.
    lit_text: String,
    /// How many leading chars of `lit_text` are sung (accent-colored).
    lit_prefix: usize,
    /// Whether the whole line is currently drawn dimmed (lyrics-always hold).
    dim: bool,
    /// Measured pixel width of the sung prefix in the lyrics font.
    lit_width: f64,
    /// Measured pixel width of `lit_text` in the lyrics font.
    text_width: f64,
    /// Current width of the karaoke clip window (depends on the element set).
    viewport: f64,
        /// Current smooth marquee scroll offset (leftwards, px).
        offset: f64,
        playing: bool,
        cover_gen: u64,
        layout: Vec<TouchBarElement>,
        cover_visible: bool,
        info_visible: bool,
        lyrics_visible: bool,
    }

    #[derive(Debug)]
    struct TouchBarUI {
        bar: Retained<NSTouchBar>,
        _target: Retained<TouchBarActionTarget>,
        /// Main cluster stack: cover → info → lyrics (AppKit-managed layout).
        cluster: Retained<NSStackView>,
        cover: Retained<NSImageView>,
        info: Retained<NSStackView>,
        title: Retained<NSTextField>,
        artist: Retained<NSTextField>,
        /// Clipping container that hosts the scrolling karaoke label.
        lyrics_clip: Retained<NSClipView>,
        lyrics: Retained<NSTextField>,
        play: Retained<NSButtonTouchBarItem>,
        applied: AppliedUi,
    }

    impl std::fmt::Debug for TouchBarActionTarget {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.debug_struct("TouchBarActionTarget").finish_non_exhaustive()
        }
    }

    // SAFETY: every AppKit object in `TouchBarUI` is only ever touched on the
    // main thread (the refresher always routes through `run_on_main_thread`);
    // the Mutex exists to narrow the reference, not to allow concurrent access.
    unsafe impl Send for TouchBarUI {}
    unsafe impl Sync for TouchBarUI {}

    static STATE: LazyLock<Mutex<BarState>> = LazyLock::new(|| Mutex::new(BarState::default()));
    static UI: LazyLock<Mutex<Option<TouchBarUI>>> = LazyLock::new(|| Mutex::new(None));
    static HANDLE: OnceLock<AppHandle> = OnceLock::new();
    static LOG_TICK: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    static ACTION_TX: OnceLock<mpsc::SyncSender<TouchBarAction>> = OnceLock::new();
    /// Images delivered by background fetch tasks, drained on the main thread.
    static PENDING_IMAGES: LazyLock<Mutex<Vec<(u64, Vec<u8>)>>> =
        LazyLock::new(|| Mutex::new(Vec::new()));

    // -----------------------------------------------------------------------
    // Action target (a tiny NSObject subclass, one selector per control).
    // -----------------------------------------------------------------------

    #[derive(Debug, Default)]
    struct TouchBarActionTargetIvars {
        _private: (),
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "SCTouchBarActionTarget"]
        #[ivars = TouchBarActionTargetIvars]
        struct TouchBarActionTarget;

        impl TouchBarActionTarget {
            #[unsafe(method(scPlayPause:))]
            fn play_pause(&self, _sender: *mut AnyObject) {
                self.dispatch(TouchBarAction::PlayPause);
            }

            #[unsafe(method(scPrev:))]
            fn prev(&self, _sender: *mut AnyObject) {
                self.dispatch(TouchBarAction::Prev);
            }

            #[unsafe(method(scNext:))]
            fn next(&self, _sender: *mut AnyObject) {
                self.dispatch(TouchBarAction::Next);
            }

            #[unsafe(method(scDismiss:))]
            fn dismiss_modal(&self, _sender: *mut AnyObject) {
                // AppKit fires actions on the main thread; dismissing here is
                // safe. `modal_presented` stays true so the refresher does not
                // fight the user and re-present the bar.
                if let Some(ui) = &*UI.lock().unwrap() {
                    dismiss_system_modal(&ui.bar);
                }
            }
        }
    );

    #[derive(Debug, Default)]
    struct FlippedViewIvars {
        _private: (),
    }

    /// A flipped host for the karaoke label: with top-left-origin coordinates
    /// the label sits where we put it, so its text lands on the cluster's
    /// exact vertical center instead of riding on typeface metrics.
    define_class!(
        #[unsafe(super(NSView))]
        #[name = "SCFlippedView"]
        #[ivars = FlippedViewIvars]
        struct SCFlippedView;

        impl SCFlippedView {
            #[unsafe(method(isFlipped))]
            fn is_flipped(&self) -> bool {
                true
            }
        }
    );

    impl TouchBarActionTarget {
        fn dispatch(&self, action: TouchBarAction) {
            // AppKit only fires actions on the main thread anyway.
            let _mtm =
                MainThreadMarker::new().expect("touch bar actions must arrive on the main thread");
            if let Some(tx) = ACTION_TX.get() {
                let _ = tx.send(action);
            }
        }

        fn new() -> Retained<Self> {
            let this = Self::alloc().set_ivars(TouchBarActionTargetIvars::default());
            unsafe { msg_send![super(this), init] }
        }
    }

    // -----------------------------------------------------------------------
    // Cross-thread entry points.
    // -----------------------------------------------------------------------

    pub fn start_touchbar(app: &AppHandle) {
        HANDLE.set(app.clone()).ok();

        let (tx, rx) = mpsc::sync_channel::<TouchBarAction>(16);
        ACTION_TX.set(tx).ok();

        let action_handle = app.clone();
        std::thread::Builder::new()
            .name("touch-bar-actions".into())
            .spawn(move || {
                while let Ok(action) = rx.recv() {
                    let event = match action {
                        TouchBarAction::PlayPause => "media:toggle",
                        TouchBarAction::Prev => "media:prev",
                        TouchBarAction::Next => "media:next",
                    };
                    action_handle.emit(event, ()).ok();
                }
            })
            .expect("failed to spawn touch-bar-actions thread");

        // Refresher: coalesces state changes into a single main-thread apply pass.
        // 10 Hz — twice the tick rate makes the karaoke fill and the cursor
        // chase read as a continuous glide instead of 200 ms steps. The
        // lyrics label's backing frame no longer resizes per tick, so the
        // earlier flicker source is gone and the higher rate stays clean.
        let handle = app.clone();
        std::thread::Builder::new()
            .name("touch-bar".into())
            .spawn(move || loop {
                std::thread::sleep(Duration::from_millis(100));
                let h = handle.clone();
                let _ = handle.run_on_main_thread(move || refresh_touchbar(&h));
            })
            .expect("failed to spawn touch-bar thread");
    }

    /// Sent from the frontend settings toggle (any thread).
    pub fn set_enabled(enabled: bool) {
        {
            let mut state = STATE.lock().unwrap();
            if state.enabled == enabled {
                return;
            }
            state.enabled = enabled;
        }
        if let Some(app) = HANDLE.get() {
            log_native(app, "INFO", format!("[TouchBar] set_enabled={enabled}"));
        }
        wake();
    }

    /// Sent from the frontend settings tab with the full touch-bar layout.
    pub fn set_config(config: TouchBarConfig) {
        let elements: Vec<TouchBarElement> = config
            .elements
            .iter()
            .filter_map(|id| TouchBarElement::from_id(id))
            .collect();
        {
            let mut state = STATE.lock().unwrap();
            if state.mode == config.mode
                && state.elements == elements
                && state.lyrics_always == config.lyrics_always
            {
                return;
            }
            state.mode = config.mode;
            state.elements = elements.clone();
            state.lyrics_always = config.lyrics_always;
        }
        if let Some(app) = HANDLE.get() {
            log_native(app, "INFO", format!("[TouchBar] set_config {:?}", elements));
        }
        wake();
    }

    /// Whether this machine has a physical Touch Bar (MacBook Pro 2016–2021).
    pub fn supported() -> bool {
        static SUPPORTED: OnceLock<bool> = OnceLock::new();
        *SUPPORTED.get_or_init(model_has_touchbar)
    }

    fn model_has_touchbar() -> bool {
        // A subprocess per launch is acceptable; the result is cached forever.
        let Ok(out) = std::process::Command::new("sysctl")
            .args(["-n", "hw.model"])
            .output()
        else {
            return true; // can't tell → assume the caller enabled it intentionally
        };
        let model = String::from_utf8_lossy(&out.stdout).trim().to_ascii_lowercase();
        let Some(rest) = model.strip_prefix("macbookpro") else {
            return false;
        };
        let Some(num) = rest
            .split(|c: char| !c.is_ascii_digit())
            .next()
            .and_then(|n| n.parse::<u32>().ok())
        else {
            return false;
        };
        // 2016 (13,1) … 2021 (18,4). MacBookPro19+ dropped the Touch Bar.
        (13..=18).contains(&num)
    }

    /// Called from the audio pipeline when track metadata lands.
    /// `cover_url` is the frontend's proxied `scproxy://localhost/img/<encoded>`
    /// URL (or `None`).
    /// Hard-clear the karaoke line regardless of `lyrics_always` hold. Called
    /// the moment the track changes so the previous song's line can never be
    /// re-held (dimmed) against the new track's position.
    pub fn reset_lyrics() {
        {
            let mut state = STATE.lock().unwrap();
            if state.lyrics.is_empty() && state.fraction == 0.0 {
                return;
            }
            state.lyrics.clear();
            state.fraction = 0.0;
            state.lyrics_reset = true;
        }
        wake();
    }

    pub fn update_metadata(title: &str, artist: &str, cover_url: Option<&str>) {
        let cover_encoded = cover_url.and_then(extract_cover_payload);
        let mut changed = false;
        {
            let mut state = STATE.lock().unwrap();
            if state.title != title || state.artist != artist {
                state.title = title.to_string();
                state.artist = artist.to_string();
                // New track: blank the strip so the previous song's line does
                // not linger (dimmed) across the switch.
                state.lyrics.clear();
                state.fraction = 0.0;
                state.lyrics_reset = true;
                changed = true;
            }
            if state.cover_encoded != cover_encoded {
                state.cover_encoded = cover_encoded.clone();
                state.cover_gen = if cover_encoded.is_some() { state.cover_gen + 1 } else { 0 };
                changed = true;
            }
        }
        if changed {
            wake();
        }
        if let Some(encoded) = cover_encoded {
            start_cover_fetch(encoded);
        }
    }

    /// The `img/` payload (URL-encoded base64) behind a `scproxy://` cover URL.
    fn extract_cover_payload(url: &str) -> Option<String> {
        url.strip_prefix("scproxy://localhost/img/")
            .map(|s| s.to_string())
    }

    /// Fetch the cover through the app's own image cache (disk-cached, so the
    /// native network hops are rare), deliver bytes back on the main thread.
    fn start_cover_fetch(encoded: String) {
        let generation = STATE.lock().unwrap().cover_gen;
        let Some(proxy) = crate::network::proxy::STATE.get() else {
            return;
        };
        proxy.rt_handle.spawn(async move {
            let result = crate::network::image_cache::handle(&encoded).await;
            if result.status != 200 || result.data.is_empty() {
                return;
            }
            // Only the newest generation may land — older fetches are stale.
            if STATE.lock().unwrap().cover_gen != generation {
                return;
            }
            let Some(handle) = HANDLE.get() else {
                return;
            };
            let h = handle.clone();
            let h2 = h.clone();
            let bytes = result.data;
            let _ = h.run_on_main_thread(move || {
                PENDING_IMAGES.lock().unwrap().push((generation, bytes));
                refresh_touchbar(&h2);
            });
        });
    }

    /// Called from the audio pipeline on play/pause transitions.
    pub fn update_playing(playing: bool) {
        {
            let mut state = STATE.lock().unwrap();
            if state.playing == playing {
                return;
            }
            state.playing = playing;
        }
        wake();
    }

    /// Called from the lyrics timing pipeline. `line` is the current lyric text,
    /// `fraction` — the 0.0..=1.0 fill progress inside that line.
    pub fn update_lyrics(line: Option<&str>, fraction: f32) {
        let text = line.unwrap_or("");
        let mut state = STATE.lock().unwrap();
        // A track just switched and the new timeline (or its absence) has not
        // delivered a real line yet: hard-clear the strip instead of keeping
        // the previous song's last line dimmed.
        if state.lyrics_reset {
            if text.is_empty() {
                if !state.lyrics.is_empty() || state.fraction != 0.0 {
                    state.lyrics.clear();
                    state.fraction = 0.0;
                    drop(state);
                    wake();
                }
                return;
            }
            state.lyrics_reset = false;
        }
        // "Lyrics always" keeps the last line rendered (dimmed) instead of
        // blanking when the panel closes / the timeline is cleared.
        if text.is_empty() && state.lyrics_always && !state.lyrics.is_empty() {
            if state.fraction != 0.0 {
                state.fraction = 0.0;
                drop(state);
                wake();
            }
            return;
        }
        if state.lyrics == text && (state.fraction - fraction).abs() < 1.0 / 60.0 {
            return;
        }
        state.lyrics = text.to_string();
        state.fraction = fraction.clamp(0.0, 1.0);
        drop(state);
        wake();
    }

    fn wake() {
        if let Some(handle) = HANDLE.get() {
            let h = handle.clone();
            let _ = handle.run_on_main_thread(move || refresh_touchbar(&h));
        }
    }

    /// Millisecond wall-clock of the last state log (throttled to ~1 Hz).
    static STATE_LOG_LAST: AtomicU64 = AtomicU64::new(0);
    fn state_clock() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    fn log_state(handle: &AppHandle, snap: &BarStateSnap, lit: usize, dim: bool, ui: &TouchBarUI) {
        let now = state_clock();
        let prev = STATE_LOG_LAST.swap(now, Ordering::Relaxed);
        if now.wrapping_sub(prev) < 1000 {
            return;
        }
        log_native(
            handle,
            "INFO",
            format!(
                "[TB-state] enabled={} mode={:?} playing={} lit={} dim={} offset={:.1} viewport={:.0} lyrics_len={} lyrics_always={}",
                snap.enabled, snap.mode, snap.playing, lit, dim, ui.applied.offset, ui.applied.viewport, snap.lyrics.len(), snap.lyrics_always,
            ),
        );
    }

    // -----------------------------------------------------------------------
    // Main-thread state application.
    // -----------------------------------------------------------------------

    fn refresh_touchbar(_handle: &AppHandle) {
        let mtm = MainThreadMarker::new().expect("touch bar refresh must run on the main thread");

        let snapshot = {
            let guard = STATE.lock().unwrap();
            BarStateSnap {
                enabled: guard.enabled,
                attached: guard.attached,
                app_attached: guard.app_attached,
                modal_presented: guard.modal_presented,
                title: guard.title.clone(),
                artist: guard.artist.clone(),
                playing: guard.playing,
                lyrics: guard.lyrics.clone(),
                fraction: guard.fraction,
                lyrics_always: guard.lyrics_always,
                cover_gen: guard.cover_gen,
                mode: guard.mode,
                elements: guard.elements.clone(),
            }
        };

        ensure_ui(mtm);
        let Some(mut ui) = UI.lock().unwrap().take() else {
            return;
        };

        // Keep the strip layout in sync with the configured element order.
        if snapshot.enabled && !ui.applied.layout.eq(&snapshot.elements) {
            rebuild_default_items(&ui.bar, &snapshot.elements);
            ui.applied.layout = snapshot.elements.clone();
        }

        // Resize the karaoke window to fit the element set: more transport
        // buttons → narrower viewport, so the scrolling line never sneaks
        // underneath the controls. Also resets the chase, since the target is
        // recomputed against the new center.
        let viewport = lyrics_viewport(&snapshot.elements, snapshot.mode == TouchBarMode::Overall);
        if snapshot.enabled && ui.applied.viewport != viewport {
            ui.lyrics_clip.setFrameSize(NSSize::new(viewport, CLUSTER_HEIGHT));
            ui.applied.viewport = viewport;
            ui.applied.offset = 0.0;
        }

        // Attach / detach the bar to the main window (`Overall` leaves it to
        // the system-modal presentation, which covers every app).
        let want_win = snapshot.enabled && snapshot.mode != TouchBarMode::Overall;
        if want_win != snapshot.attached {
            if let Some(win) = main_ns_window() {
                win.setTouchBar(want_win.then_some(&*ui.bar));
                STATE.lock().unwrap().attached = want_win;
            }
        }

        // App-level attach keeps the strip visible while the window is
        // minimized/hidden (Always mode).
        let want_app = snapshot.enabled && snapshot.mode == TouchBarMode::Always;
        if want_app != snapshot.app_attached {
            NSApplication::sharedApplication(mtm).setTouchBar(want_app.then_some(&*ui.bar));
            STATE.lock().unwrap().app_attached = want_app;
        }

        // `Overall` presents the strip as a system-modal touch bar: a single
        // public call (`+presentSystemModalTouchBar:systemTrayItemIdentifier:`)
        // keeps it on screen across every app. We drive it on mode transitions
        // only — never re-presenting while the flag stays set, so a dismissal
        // the user performed themselves is respected until the next change.
        let want_modal = snapshot.enabled && snapshot.mode == TouchBarMode::Overall;
        if want_modal && !snapshot.modal_presented {
            present_system_modal(&ui.bar);
            STATE.lock().unwrap().modal_presented = true;
        } else if !want_modal && snapshot.modal_presented {
            dismiss_system_modal(&ui.bar);
            STATE.lock().unwrap().modal_presented = false;
        }

        let full_len = snapshot.lyrics.chars().count();
        let lit = scaled_lit(snapshot.fraction, full_len) as usize;
        let dim = lit == 0 && snapshot.lyrics_always && full_len > 0;

        if snapshot.enabled {
            apply_snapshot(mtm, &mut ui, &snapshot, lit, dim);
        }

        log_state(_handle, &snapshot, lit, dim, &ui);
        *UI.lock().unwrap() = Some(ui);
    }

    fn apply_snapshot(
        mtm: MainThreadMarker,
        ui: &mut TouchBarUI,
        snap: &BarStateSnap,
        lit: usize,
        dim: bool,
    ) {
        let title_text = first_words(&snap.title, 2);
        if ui.applied.title != title_text {
            let attr = label_attr(mtm, &title_text, true);
            ui.title.setAttributedStringValue(attr.as_super());
            ui.applied.title = title_text;
        }
        if ui.applied.artist != snap.artist {
            let attr = label_attr(mtm, &snap.artist, false);
            ui.artist.setAttributedStringValue(attr.as_super());
            ui.applied.artist = snap.artist.clone();
        }

        // Cluster visibility: cover → info → lyrics. The stack view repacks
        // itself whenever an element is hidden, keeping cover left, name right
        // after it and the karaoke strip last.
        let show_cover = snap.elements.contains(&TouchBarElement::Cover);
        let show_info = snap.elements.contains(&TouchBarElement::Info);
        let show_lyrics = snap.elements.contains(&TouchBarElement::Lyrics);
        if ui.applied.cover_visible != show_cover {
            set_visibility(&ui.cluster, ui.cover.as_super(), show_cover);
            ui.applied.cover_visible = show_cover;
        }
        if ui.applied.info_visible != show_info {
            set_visibility(&ui.cluster, stack_view(&ui.info), show_info);
            ui.applied.info_visible = show_info;
        }
        if ui.applied.lyrics_visible != show_lyrics {
            set_visibility(&ui.cluster, ui.lyrics_clip.as_super(), show_lyrics);
            ui.applied.lyrics_visible = show_lyrics;
        }

        // Karaoke: the FULL line is rendered every tick — the sung prefix in the
        // accent color and the un-sung remainder in gray, mirroring the in-app
        // lyric cursor. When it outgrows the fixed-width clip it scrolls
        // right-to-left (sung tail pinned at the right edge). The backing
        // frame keeps its fixed size — resizing it per tick is what made the
        // label flash hard on the Touch Bar.
        //
        // "Lyrics always" keeps the last known line visible even when nothing
        // is being sung right now (panel closed / instrumental gap): it is
        // drawn wholly dimmed instead of the accent-colored sung prefix.
        if ui.applied.lit_text != snap.lyrics
            || ui.applied.lit_prefix != lit
            || ui.applied.dim != dim
        {
            // Plain attribute swap — no implicit animation involved, so it does
            // not need an animation group.
            ui.applied.lit_text = snap.lyrics.clone();
            ui.applied.lit_prefix = lit;
            ui.applied.dim = dim;
            let attr = lyrics_attr(mtm, &snap.lyrics, lit, dim);
            ui.lyrics.setAttributedStringValue(attr.as_super());
            ui.applied.text_width = attr.as_super().size().width;
            // Width of the sung prefix drives the karaoke scroll target, so
            // measure it with the same font while we already have the colors.
            let lit_width = if !dim && lit > 0 {
                let prefix = snap.lyrics.chars().take(lit).collect::<String>();
                lyrics_attr(mtm, &prefix, usize::MAX, true)
                    .as_super()
                    .size()
                    .width
            } else {
                0.0
            };
            ui.applied.lit_width = lit_width;
        }
        if LOG_TICK.fetch_add(1, std::sync::atomic::Ordering::Relaxed) % 50 == 0
            && let Some(app) = HANDLE.get()
        {
            log_native(
                app,
                "INFO",
                format!(
                    "[TouchBar] {:?} lit={} dim={} offset={:.1}",
                    snap.title.split(' ').next().unwrap_or(""),
                    lit,
                    dim,
                    ui.applied.offset
                ),
            );
        }
        // Karaoke scroll, cursor-anchored: while the sung prefix still fits left of
        // the clip's middle the line stays put at the left edge; once the
        // boundary passes the center the strip eases left so the "current
        // letter" keeps hovering around the middle. Two clamps keep the text
        // from running off the edges: never scroll back past 0, and never let
        // the line's right end slide left of the clip's right edge, so the
        // line's tail — exactly the part the eye is following — is always
        // visible and cleanly clipped at the margins.
        let full_excess = (ui.applied.text_width - ui.applied.viewport).max(0.0);
        let target = (ui.applied.lit_width - ui.applied.viewport * 0.5)
            .max(0.0)
            .min(full_excess);
        let next = if (target - ui.applied.offset).abs() < 0.5 {
            target
        } else {
            ui.applied.offset + (target - ui.applied.offset) * 0.35
        };
        if (next - ui.applied.offset).abs() > 0.05 {
            // Zero-duration group only around the viewport move: implicit
            // bounds animations otherwise pile up at the 5 Hz refresh rate.
            NSAnimationContext::beginGrouping();
            NSAnimationContext::currentContext().setDuration(0.0);
            ui.lyrics_clip.setBoundsOrigin(NSPoint::new(next, 0.0));
            ui.applied.offset = next;
            NSAnimationContext::endGrouping();
        }

        if ui.applied.playing != snap.playing {
            if let Some(img) = play_pause_image(snap.playing) {
                ui.play.setImage(Some(&img));
            }
        }
        apply_cover(ui, snap.cover_gen);

        ui.applied.playing = snap.playing;
    }

    fn set_visibility(stack: &NSStackView, view: &NSView, visible: bool) {
        let priority = if visible {
            objc2_app_kit::NSStackViewVisibilityPriorityMustHold
        } else {
            objc2_app_kit::NSStackViewVisibilityPriorityNotVisible
        };
        stack.setVisibilityPriority_forView(priority, view);
        view.setHidden(!visible);
    }

    /// Round the cover bytes into a 36×36 image with transparent rounded
    /// corners (baked via an NSBezierPath clip — no CALayer involved, so it
    /// works even before the touch bar exposes backing layers).
    fn rounded_cover_image(
        mtm: MainThreadMarker,
        src: &NSImage,
    ) -> Option<Retained<NSImage>> {
        let size = NSSize::new(COVER_SIZE, COVER_SIZE);
        let rect = NSRect::new(NSPoint::new(0.0, 0.0), size);
        let dst = NSImage::initWithSize(NSImage::alloc(), size);
        dst.lockFocus();
        let path = NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(
            rect,
            COVER_RADIUS,
            COVER_RADIUS,
        );
        path.addClip();
        src.drawInRect(rect);
        dst.unlockFocus();
        let _ = mtm;
        Some(dst)
    }

    fn apply_cover(ui: &mut TouchBarUI, cover_gen: u64) {
        if ui.applied.cover_gen == cover_gen {
            return;
        }
        if cover_gen == 0 {
            ui.cover.setImage(None);
            ui.applied.cover_gen = 0;
            return;
        }
        // Drain the queue; keep the newest image for the current generation.
        let mut pending = PENDING_IMAGES.lock().unwrap();
        let latest = pending
            .drain(..)
            .filter(|(generation, _)| *generation == cover_gen)
            .last()
            .map(|(_, bytes)| bytes);
        drop(pending);
        let Some(bytes) = latest else {
            // Fetch still in flight — retried on the next refresh pass.
            return;
        };
        let data = NSData::with_bytes(&bytes);
        if let Some(img) = NSImage::initWithData(NSImage::alloc(), &data)
            && let Some(rounded) = rounded_cover_image(MainThreadMarker::new().unwrap(), &img)
        {
            // Lock the intrinsic size so the stack gives the image view a
            // stable 36×36 slot instead of scaling to the source dimensions.
            rounded.setSize(NSSize::new(COVER_SIZE, COVER_SIZE));
            ui.cover.setImage(Some(&rounded));
            ui.applied.cover_gen = cover_gen;
        }
    }

    fn scaled_lit(fraction: f32, char_count: usize) -> u64 {
        if char_count == 0 {
            return 0;
        }
        let chars = (fraction * char_count as f32).round() as usize;
        chars.min(char_count) as u64
    }

    /// Keep the title legible on the strip: at most `n` words, ellipsized.
    fn first_words(text: &str, n: usize) -> String {
        let words: Vec<&str> = text.split_whitespace().collect();
        if words.len() <= n {
            return text.to_string();
        }
        format!("{}…", words[..n].join(" "))
    }

    /// Width of the karaoke window for the given element set. Every transport
    /// button (Prev/Play/Next) in the layout owns a slice of the bar, so the
    /// lyrics viewport shrinks accordingly — otherwise the scrolling line
    /// slides underneath the controls instead of clipping at its own edge.
    fn lyrics_viewport(elements: &[TouchBarElement], modal: bool) -> f64 {
        let transport = elements
            .iter()
            .filter(|e| matches!(e, TouchBarElement::Prev | TouchBarElement::Play | TouchBarElement::Next))
            .count() as f64;
        let width = LYRICS_WIDTH_BASE - transport * TRANSPORT_ITEM_WIDTH;
        if modal {
            (width - MODAL_MARGIN).max(MIN_LYRICS_WIDTH)
        } else {
            width.max(MIN_LYRICS_WIDTH)
        }
    }

    #[derive(Debug, Clone)]
    struct BarStateSnap {
        enabled: bool,
        attached: bool,
        app_attached: bool,
        modal_presented: bool,
        title: String,
        artist: String,
        playing: bool,
        lyrics: String,
        fraction: f32,
        lyrics_always: bool,
        cover_gen: u64,
        mode: TouchBarMode,
        elements: Vec<TouchBarElement>,
    }

    /// Recompute `defaultItemIdentifiers` from the configured order. `Cover`,
    /// `Info` and `Lyrics` share one clustered item (`Main`), which is placed
    /// at the position of the first of the three; disabled members just hide
    /// their sub-view inside the cluster. Everything stays in templateItems so
    /// disabling is a pure re-default (no rebuild).
    fn rebuild_default_items(bar: &NSTouchBar, elements: &[TouchBarElement]) {
        let list = default_items(elements);
        let ids: Vec<Retained<NSString>> = list.iter().map(|e| e.identifier()).collect();
        let refs: Vec<&NSString> = ids.iter().map(|id| &**id).collect();
        bar.setDefaultItemIdentifiers(&NSArray::from_slice(&refs));
        // No principal item: the whole strip hugs the leading edge (cover at
        // the far left, karaoke right after the name).
        bar.setPrincipalItemIdentifier(None);
    }

    /// Collapse cover/info/lyrics into a single `Main` cluster at the position
    /// of the first of them; transport items keep their configured order.
    fn default_items(elements: &[TouchBarElement]) -> Vec<TouchBarElement> {
        let mut out: Vec<TouchBarElement> = Vec::new();
        let mut main_added = false;
        for e in elements {
            match e {
                TouchBarElement::Cover
                | TouchBarElement::Info
                | TouchBarElement::Lyrics if !main_added => {
                    out.push(TouchBarElement::Main);
                    main_added = true;
                }
                TouchBarElement::Cover | TouchBarElement::Info | TouchBarElement::Lyrics => {}
                other => out.push(*other),
            }
        }
        out
    }

    impl TouchBarElement {
        fn touchbar_id(self) -> &'static str {
            match self {
                Self::Cover | Self::Info | Self::Lyrics | Self::Main => "scMain",
                Self::Prev => "scPrev",
                Self::Play => "scPlayPause",
                Self::Next => "scNext",
            }
        }

        fn identifier(self) -> Retained<NSString> {
            NSString::from_str(self.touchbar_id())
        }
    }

    fn ensure_ui(mtm: MainThreadMarker) {
        if UI.lock().unwrap().is_some() {
            return;
        }

        let id_main = NSString::from_str("scMain");
        let id_prev = NSString::from_str("scPrev");
        let id_play = NSString::from_str("scPlayPause");
        let id_next = NSString::from_str("scNext");
        let id_modal = NSString::from_str(MODAL_TRAY_ID);

        let target = TouchBarActionTarget::new();

        let prev = button_item(
            mtm,
            &id_prev,
            "backward.end",
            "Previous track",
            &target,
            sel!(scPrev:),
        );
        let play = button_item(
            mtm,
            &id_play,
            "play.fill",
            "Play",
            &target,
            sel!(scPlayPause:),
        );
        let next = button_item(
            mtm,
            &id_next,
            "forward.end",
            "Next track",
            &target,
            sel!(scNext:),
        );

        // Dismiss control for the system-modal bar (`Overall` mode): a small
        // "chevron-down" that calls `scDismiss:`. It stays out of the default
        // strip and is resolved only when the bar is presented modally.
        let modal_dismiss = button_item(
            mtm,
            &id_modal,
            "chevron.down.circle",
            "Hide SoundCloud bar",
            &target,
            sel!(scDismiss:),
        );

        let title = NSTextField::labelWithString(&NSString::from_str(""), mtm);
        title.setFont(Some(&font_bold()));
        title.setTextColor(Some(&color_white()));
        title.setAlignment(NSTextAlignment::Left);
        title.setLineBreakMode(NSLineBreakMode::ByTruncatingTail);
        title.setPreferredMaxLayoutWidth(170.0);

        let artist = NSTextField::labelWithString(&NSString::from_str(""), mtm);
        artist.setFont(Some(&font_normal()));
        artist.setTextColor(Some(&color_gray()));
        artist.setAlignment(NSTextAlignment::Left);
        artist.setLineBreakMode(NSLineBreakMode::ByTruncatingTail);
        artist.setPreferredMaxLayoutWidth(170.0);

        // Track info = title stacked over artist.
        let info = NSStackView::stackViewWithViews(
            &NSArray::from_slice(&[field_view(&title), field_view(&artist)]),
            mtm,
        );
        info.setOrientation(NSUserInterfaceLayoutOrientation::Vertical);
        info.setSpacing(1.0);
        info.setAlignment(NSLayoutAttribute::Leading);
        info.setFrameSize(NSSize::new(INFO_WIDTH, CLUSTER_HEIGHT));

        // Cover art slot (filled asynchronously once metadata lands); the
        // corners are rounded by the backing CALayer once available.
        let cover = NSImageView::initWithFrame(
            NSImageView::alloc(mtm),
            NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(COVER_SIZE, COVER_SIZE)),
        );
        cover.setImageScaling(NSImageScaling::ScaleProportionallyUpOrDown);

        // Karaoke label inside a clipped container: only the sung prefix is
        // shown, and it scrolls right-to-left when wider than the viewport.
        let lyrics = NSTextField::labelWithString(&NSString::from_str(""), mtm);
        lyrics.setFont(Some(&font_lyrics()));
        lyrics.setTextColor(Some(&color_accent()));
        lyrics.setLineBreakMode(NSLineBreakMode::ByClipping);
        lyrics.setAlignment(NSTextAlignment::Left);
        lyrics.setBordered(false);
        // Backing frame is fixed and wide — per-tick resizes are what made the
        // field flash on the Touch Bar; the clip window scrolls inside it.
        lyrics.setFrameSize(NSSize::new(LYRICS_TEXT_MAX_WIDTH, 20.0));
        // Flipped host: text starts at the top-left of ITS frame, so a 20 pt
        // label at y=2 sits dead-center of the 24 pt cluster (2 pt above and
        // below) regardless of font ascender/descender asymmetry.
        let lyrics_host = unsafe {
            let host = msg_send![SCFlippedView::class(), alloc];
            msg_send![host, initWithFrame:NSRect::new(
                NSPoint::new(0.0, 0.0),
                NSSize::new(LYRICS_TEXT_MAX_WIDTH, CLUSTER_HEIGHT),
            )]
        };
        let lyrics_host: Retained<SCFlippedView> = lyrics_host;
        lyrics.setFrameOrigin(NSPoint::new(0.0, 2.0));
        lyrics_host.as_super().addSubview(&*lyrics);

        let lyrics_clip = NSClipView::initWithFrame(
            NSClipView::alloc(mtm),
            NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(LYRICS_WIDTH_BASE, CLUSTER_HEIGHT)),
        );
        lyrics_clip.setDrawsBackground(false);
        lyrics_clip.setDocumentView(Some(lyrics_host.as_super()));

        // Cluster: cover → info → lyrics as one AppKit-managed horizontal
        // stack. It is a regular (non-principal) item so the whole group hugs
        // the left edge of the Touch Bar instead of being centered.
        let cluster = NSStackView::stackViewWithViews(
            &NSArray::from_slice(&[
                cover.as_super().as_super(),
                stack_view(&info),
                lyrics_clip.as_super(),
            ]),
            mtm,
        );
        cluster.setOrientation(NSUserInterfaceLayoutOrientation::Horizontal);
        cluster.setSpacing(CLUSTER_GAP);
        cluster.setAlignment(NSLayoutAttribute::CenterY);

        let main_item = custom_item(mtm, &id_main, &*cluster);

        let bar = NSTouchBar::new(mtm);
        bar.setTemplateItems(&NSSet::from_slice(&[
            prev.as_super(),
            play.as_super(),
            next.as_super(),
            main_item.as_super(),
            modal_dismiss.as_super(),
        ]));
        // System tray slot for the dismiss button (used by `Overall`).
        unsafe {
            let _: () = msg_send![
                NSTouchBarItem::class(),
                addSystemTrayItem:&*modal_dismiss
            ];
        }
        // Defaults applied on the first refresh pass (config may disable items).
        bar.setDefaultItemIdentifiers(&NSArray::from_slice(&[&*id_main]));
        bar.setPrincipalItemIdentifier(None);

        *UI.lock().unwrap() = Some(TouchBarUI {
            bar,
            _target: target,
            cluster,
            cover,
            info,
            title,
            artist,
            lyrics_clip,
            lyrics,
            play,
            applied: AppliedUi::default(),
        });
        if let Some(app) = HANDLE.get() {
            log_native(app, "INFO", "[TouchBar] UI constructed (cover + info + karaoke clip + transport)");
        }
    }

    /// Upcast NSTextField → NSView for `setView`.
    fn field_view(field: &NSTextField) -> &NSView {
        field.as_super().as_super()
    }

    /// Present the strip as a system-modal touch bar. This is the public
    /// macOS 10.14+ API behind the "Touch Bar over every app" behaviour of
    /// apps like BTT/Pock: the bar stays up across foreground switches until
    /// the user dismisses it. Safe only on the main thread.
    fn present_system_modal(bar: &NSTouchBar) {
        let tray = NSString::from_str(MODAL_TRAY_ID);
        unsafe {
            let _: () = msg_send![
                NSTouchBar::class(),
                presentSystemModalTouchBar:&*bar,
                systemTrayItemIdentifier:&*tray
            ];
        }
        if let Some(app) = HANDLE.get() {
            log_native(app, "INFO", "[TouchBar] system-modal presented (Overall: strips over all apps)");
        }
    }

    /// Dismiss a system-modal touch bar presented by [`present_system_modal`].
    /// No-op if nothing is on screen. Safe only on the main thread.
    fn dismiss_system_modal(bar: &NSTouchBar) {
        unsafe {
            let _: () = msg_send![
                NSTouchBar::class(),
                dismissSystemModalTouchBar:&*bar
            ];
        }
        if let Some(app) = HANDLE.get() {
            log_native(app, "INFO", "[TouchBar] system-modal dismissed");
        }
    }

    /// Upcast NSStackView → NSView for `setView`.
    fn stack_view(stack: &NSStackView) -> &NSView {
        stack.as_super()
    }

    fn custom_item(
        mtm: MainThreadMarker,
        identifier: &NSTouchBarItemIdentifier,
        view: &NSView,
    ) -> Retained<NSCustomTouchBarItem> {
        let item =
            NSCustomTouchBarItem::initWithIdentifier(NSCustomTouchBarItem::alloc(mtm), identifier);
        item.setView(view);
        let _ = mtm;
        item
    }

    fn button_item(
        mtm: MainThreadMarker,
        identifier: &NSTouchBarItemIdentifier,
        symbol: &str,
        description: &str,
        target: &TouchBarActionTarget,
        action: Sel,
    ) -> Retained<NSButtonTouchBarItem> {
        let target_any: &AnyObject = target.as_super().as_super();
        let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(
            &NSString::from_str(symbol),
            Some(&NSString::from_str(description)),
        );
        unsafe {
            match image {
                Some(img) => {
                    NSButtonTouchBarItem::buttonTouchBarItemWithIdentifier_image_target_action(
                        identifier,
                        &*img,
                        Some(target_any),
                        Some(action),
                        mtm,
                    )
                }
                None => NSButtonTouchBarItem::buttonTouchBarItemWithIdentifier_title_target_action(
                    identifier,
                    &NSString::from_str(symbol),
                    Some(target_any),
                    Some(action),
                    mtm,
                ),
            }
        }
    }

    /// Resolve the main window's NSWindow from raw-window-handle (safe only on
    /// the main thread).
    fn main_ns_window() -> Option<Retained<NSWindow>> {
        let handle = HANDLE.get()?;
        let win = handle.get_webview_window("main")?;
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        let raw = win.window_handle().ok()?.as_raw();
        let RawWindowHandle::AppKit(h) = raw else {
            return None;
        };
        // SAFETY: `h.ns_view` is a valid `NSView*` owned by the app; the pointer
        // is retained only for the duration of this call.
        let view = unsafe { Retained::retain(h.ns_view.as_ptr().cast::<NSView>())? };
        view.window()
    }

    fn label_attr(mtm: MainThreadMarker, text: &str, bold: bool) -> Retained<NSMutableAttributedString> {
        let ns = NSString::from_str(text);
        let attr =
            NSMutableAttributedString::initWithString(NSMutableAttributedString::alloc(), &ns);
        let range = NSRange::new(0, ns.length());
        let color = if bold { color_white() } else { color_gray() };
        let color_any: Retained<AnyObject> = color.into();
        // SAFETY: attribute value must be an object (`NSColor`, `NSFont`).
        unsafe {
            attr.addAttribute_value_range(&NSForegroundColorAttributeName, &*color_any, range);
        }
        if bold {
            let font_any: Retained<AnyObject> = font_bold().into();
            unsafe {
                attr.addAttribute_value_range(&NSFontAttributeName, &*font_any, range);
            }
        }
        let _ = mtm;
        attr
    }

    /// Attributed lyric text: the full line with the sung prefix (`lit` leading
    /// chars) in the accent color and the un-sung remainder in the muted gray;
    /// `dim` draws the whole line gray (used by lyrics-always hold).
    fn lyrics_attr(
        mtm: MainThreadMarker,
        text: &str,
        lit: usize,
        dim: bool,
    ) -> Retained<NSMutableAttributedString> {
        let ns = NSString::from_str(text);
        let attr =
            NSMutableAttributedString::initWithString(NSMutableAttributedString::alloc(), &ns);
        let range = NSRange::new(0, ns.length());
        let gray_any: Retained<AnyObject> = color_gray().into();
        let font_any: Retained<AnyObject> = font_lyrics().into();
        // SAFETY: attribute values are objects (`NSColor`, `NSFont`).
        unsafe {
            attr.addAttribute_value_range(&NSForegroundColorAttributeName, &*gray_any, range);
            attr.addAttribute_value_range(&NSFontAttributeName, &*font_any, range);
        }
        if !dim && lit > 0 {
            let prefix = text.chars().take(lit).collect::<String>();
            let pns = NSString::from_str(&prefix);
            let prange = NSRange::new(0, pns.length());
            let accent_any: Retained<AnyObject> = color_accent().into();
            // SAFETY: `accent_any` is an `NSColor`.
            unsafe {
                attr.addAttribute_value_range(&NSForegroundColorAttributeName, &*accent_any, prange);
            }
        }
        let _ = mtm;
        attr
    }

    // Colors / fonts / symbols -------------------------------------------------

    use objc2_app_kit::NSColor as _NSColor;

    fn color_white() -> Retained<_NSColor> {
        _NSColor::whiteColor()
    }

    fn color_gray() -> Retained<_NSColor> {
        _NSColor::systemGrayColor()
    }

    /// Bright filled-char color for the karaoke text.
    fn color_accent() -> Retained<_NSColor> {
        _NSColor::whiteColor()
    }

    fn font_normal() -> Retained<objc2_app_kit::NSFont> {
        objc2_app_kit::NSFont::systemFontOfSize(13.0)
    }

    fn font_bold() -> Retained<objc2_app_kit::NSFont> {
        objc2_app_kit::NSFont::boldSystemFontOfSize(13.0)
    }

    fn font_lyrics() -> Retained<objc2_app_kit::NSFont> {
        objc2_app_kit::NSFont::systemFontOfSize(18.0)
    }

    fn play_pause_image(playing: bool) -> Option<Retained<NSImage>> {
        let (symbol, description) = if playing {
            ("pause.fill", "Pause")
        } else {
            ("play.fill", "Play")
        };
        NSImage::imageWithSystemSymbolName_accessibilityDescription(
            &NSString::from_str(symbol),
            Some(&NSString::from_str(description)),
        )
    }
}

#[cfg(not(target_os = "macos"))]
mod detail {
    use crate::rt::AppHandle;
    use super::TouchBarConfig;

    pub fn start_touchbar(_app: &AppHandle) {}
    pub fn set_enabled(_enabled: bool) {}
    pub fn set_config(_config: TouchBarConfig) {}
    pub fn reset_lyrics() {}
    pub fn supported() -> bool {
        false
    }
    pub fn update_metadata(_title: &str, _artist: &str, _cover_url: Option<&str>) {}
    pub fn update_playing(_playing: bool) {}
    pub fn update_lyrics(_line: Option<&str>, _fraction: f32) {}
}

pub use detail::{
    reset_lyrics, set_config, set_enabled, start_touchbar, supported, update_lyrics,
    update_metadata, update_playing,
};