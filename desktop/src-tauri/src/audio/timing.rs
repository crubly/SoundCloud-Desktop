use tauri::{Emitter, State};

use crate::audio::state::{AudioState, CommentsTimelineState, LyricsTimelineState};
use crate::audio::types::{FloatingCommentEvent, LyricsTimingLine};
use std::sync::atomic::{AtomicU64, Ordering};

/// Millisecond wall-clock of the last sync debug line (throttled to ~1 Hz).
static SYNC_LOG_LAST: AtomicU64 = AtomicU64::new(0);

fn sync_clock() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn log_sync(handle: &crate::rt::AppHandle, msg: String) {
    let now = sync_clock();
    let prev = SYNC_LOG_LAST.swap(now, Ordering::Relaxed);
    if now.wrapping_sub(prev) < 1000 {
        return;
    }
    crate::app::diagnostics::log_native(handle, "INFO", format!("[LyricsSync] {msg}"));
}

pub fn audio_set_lyrics_timeline(
    app: crate::rt::AppHandle,
    lines: Vec<LyricsTimingLine>,
    state: State<'_, AudioState>,
) {
    let mut sorted = lines;
    sorted.sort_by(|a, b| a.time_secs.total_cmp(&b.time_secs));
    let count = sorted.len();
    *state.lyrics_timeline.lock().unwrap() = Some(LyricsTimelineState {
        lines: sorted,
        active_index: None,
    });
    log_sync(&app, format!("timeline set: {count} lines"));
}

pub fn audio_clear_lyrics_timeline(app: crate::rt::AppHandle, state: State<'_, AudioState>) {
    *state.lyrics_timeline.lock().unwrap() = None;
    log_sync(&app, "timeline cleared".into());
}

pub fn audio_set_comments_timeline(
    comments: Vec<FloatingCommentEvent>,
    state: State<'_, AudioState>,
) {
    let mut sorted = comments;
    sorted.sort_by_key(|comment| comment.timestamp_ms);
    *state.comments_timeline.lock().unwrap() = Some(CommentsTimelineState {
        comments: sorted,
        next_index: 0,
    });
}

pub fn audio_clear_comments_timeline(state: State<'_, AudioState>) {
    *state.comments_timeline.lock().unwrap() = None;
}

pub fn process_lyrics_timeline(handle: &crate::rt::AppHandle, state: &AudioState, pos_secs: f64) {
    let mut timeline = state.lyrics_timeline.lock().unwrap();
    let Some(timeline) = timeline.as_mut() else {
        crate::touchbar::update_lyrics(None, 0.0);
        return;
    };

    let mut next_active = None;
    for (index, line) in timeline.lines.iter().enumerate().rev() {
        if line.time_secs <= pos_secs {
            next_active = Some(index);
            break;
        }
    }

    // Karaoke progress for the touch bar: the active REAL verse fills over
    // [time_secs, end_secs). Instrumental-break markers (♪♪♪, `pause`) never
    // appear on the bar — instead the last real verse keeps the spotlight and
    // keeps filling toward the next verse start, so a line never "completes"
    // (or gets replaced) in the run-up to a musical pause. That mirrors the
    // in-app panel's hold behaviour. The marker index is still what drives
    // `lyrics:active_line` for the panel.
    let tb_real = timeline
        .lines
        .iter()
        .enumerate()
        .rev()
        .find(|(_, line)| line.time_secs <= pos_secs && !line.pause)
        .map(|(index, _)| index);

    let line = tb_real.and_then(|index| timeline.lines.get(index));
    if let Some(line) = line {
        let fill = if let Some(end_secs) = line.end_secs
            && end_secs > line.time_secs
            && line.text.is_some()
        {
            ((pos_secs - line.time_secs) / (end_secs - line.time_secs)).clamp(0.0, 1.0) as f32
        } else if line.text.is_some() {
            1.0
        } else {
            0.0
        };
        crate::touchbar::update_lyrics(line.text.as_deref(), fill);
        log_sync(
            handle,
            format!(
                "pos={pos_secs:.2}s start={:.2} fill={:.2} text={:?}",
                line.time_secs,
                fill,
                line.text.as_deref().unwrap_or("").chars().take(12).collect::<String>(),
            ),
        );
    } else {
        // Intro — nothing real sung yet: leave the strip blank.
        crate::touchbar::update_lyrics(None, 0.0);
    }

    if timeline.active_index != next_active {
        timeline.active_index = next_active;
        handle
            .emit("lyrics:active_line", next_active.map(|index| index as i64))
            .ok();
    }
}

pub fn process_comments_timeline(handle: &crate::rt::AppHandle, state: &AudioState, pos_secs: f64) {
    let mut timeline = state.comments_timeline.lock().unwrap();
    let Some(timeline) = timeline.as_mut() else {
        return;
    };

    let current_ms = (pos_secs * 1000.0).max(0.0) as u64;

    while timeline.next_index > 0
        && timeline.comments[timeline.next_index - 1].timestamp_ms > current_ms + 2_000
    {
        timeline.next_index -= 1;
    }

    while timeline.next_index < timeline.comments.len() {
        let comment = &timeline.comments[timeline.next_index];
        if comment.timestamp_ms + 2_000 < current_ms {
            timeline.next_index += 1;
            continue;
        }
        if comment.timestamp_ms > current_ms + 2_000 {
            break;
        }
        handle.emit("comments:show", comment.clone()).ok();
        timeline.next_index += 1;
    }
}
