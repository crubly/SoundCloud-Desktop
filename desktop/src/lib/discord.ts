import type { Track } from '../stores/player';
import { usePlayerStore } from '../stores/player';
import { useSettingsStore } from '../stores/settings';
import { getCurrentTime, subscribePlaybackTime } from './audio';
import { trackedInvoke as invoke } from './diagnostics';
import { getArtistDisplay, getDisplayTitle } from './track-display';
import { isYouTubeUrn } from './youtube';

let connected = false;
let lastConnectAttemptAt = 0;
const CONNECT_RETRY_MS = 5000;
const LOOPED_PART_SUFFIX = ' (looped part)';

async function ensureConnected(): Promise<boolean> {
  if (!useSettingsStore.getState().discordRpcEnabled) {
    return false;
  }
  if (connected) return true;
  const now = Date.now();
  if (now - lastConnectAttemptAt < CONNECT_RETRY_MS) {
    return false;
  }
  lastConnectAttemptAt = now;
  try {
    connected = await invoke<boolean>('discord_connect');
    return connected;
  } catch {
    return false;
  }
}

function artworkToLarge(url: string | null): string | undefined {
  if (!url) return undefined;
  return url.replace(/-[^-./]+(\.[^.]+)$/, '-t500x500$1');
}

/* ── Сериализация обновлений ────────────────────────────────────
 * set_activity выполняется в Rust блокирующе; чтобы последний запрошенный трек
 * ВСЕГДА оказывался последним записанным в Discord (а не обгонялся старым),
 * проталкиваем обновления через цепочку промисов — строго по порядку. */
let updateChain: Promise<void> = Promise.resolve();

function enqueuePresence(run: () => Promise<void>): Promise<void> {
  const next = updateChain.then(run);
  updateChain = next.catch(() => undefined);
  return next;
}

async function updatePresence(track: Track, elapsedSecs: number) {
  if (!(await ensureConnected())) return;

  const isPlaying = usePlayerStore.getState().isPlaying;
  const {
    discordRpcMode,
    discordRpcShowButton,
    discordRpcButtonText,
    discordRpcYouTubeButtonText,
    discordRpcHidePaused,
  } = useSettingsStore.getState();
  const display = getArtistDisplay(track);
  const loop = usePlayerStore.getState().abLoop;
  const displayTitle = `${getDisplayTitle(track)}${loop?.b != null ? LOOPED_PART_SUFFIX : ''}`;
  const artist = display.primary || track.user.username;

  await enqueuePresence(async () => {
    try {
      await invoke('discord_set_activity', {
        track: {
          title: displayTitle,
          artist,
          artwork_url: artworkToLarge(track.artwork_url),
          track_url: track.permalink_url
            ? `${track.permalink_url}`.replace(/\?.*$/, '')
            : undefined,
          duration_secs: Math.round(track.duration / 1000),
          elapsed_secs: elapsedSecs,
          is_playing: isPlaying,
          mode: discordRpcMode,
          show_button: discordRpcShowButton,
          button_label: isYouTubeUrn(track.urn) ? discordRpcYouTubeButtonText : discordRpcButtonText,
          hide_on_pause: discordRpcHidePaused,
        },
      });
    } catch (e) {
      console.warn('[Discord] Failed to set activity:', e);
      connected = false;
    }
  });
}

async function clearPresence() {
  if (!connected) return;
  try {
    await invoke('discord_clear_activity');
  } catch {
    connected = false;
  }
}

let lastUrn: string | null = null;
let lastPlaying = false;
let lastLooped = false;
let lastElapsed = 0;
let lastFullSyncAt = 0;
let seekSyncTimer: ReturnType<typeof setTimeout> | null = null;

const HEARTBEAT_MS = 20_000;

function schedulePresenceSync(track: Track, delayMs: number) {
  if (seekSyncTimer) clearTimeout(seekSyncTimer);
  seekSyncTimer = setTimeout(() => {
    seekSyncTimer = null;
    lastElapsed = Math.round(getCurrentTime());
    updatePresence(track, lastElapsed);
  }, delayMs);
}

usePlayerStore.subscribe((state) => {
  const { currentTrack, isPlaying } = state;

  const trackChanged = currentTrack?.urn !== lastUrn;
  const playChanged = isPlaying !== lastPlaying;
  const looped = state.abLoop?.b != null;
  const loopChanged = looped !== lastLooped;

  if (!currentTrack) {
    if (lastPlaying || trackChanged) {
      clearPresence();
    }
    if (seekSyncTimer) {
      clearTimeout(seekSyncTimer);
      seekSyncTimer = null;
    }
    lastUrn = null;
    lastPlaying = false;
    lastLooped = false;
    lastElapsed = 0;
    return;
  }

  if (trackChanged || playChanged || loopChanged) {
    if (seekSyncTimer) {
      clearTimeout(seekSyncTimer);
      seekSyncTimer = null;
    }
    lastUrn = currentTrack.urn;
    lastPlaying = isPlaying;
    lastLooped = looped;
    // Важно: при смене трека elapsed ещё читает ПОЗИЦИЮ ПРЕДЫДУЩЕГО трека
    // (тикер сбрасывает кэш только внутри асинхронного loadTrack). Стартуем
    // presence с нуля — точную позицию донесут последующие тики по drift.
    const elapsed = trackChanged ? 0 : Math.round(getCurrentTime());
    lastElapsed = elapsed;
    lastFullSyncAt = Date.now();
    updatePresence(currentTrack, elapsed);
  }
});

useSettingsStore.subscribe((state, prev) => {
  const rpcSettingsChanged =
    state.discordRpcEnabled !== prev.discordRpcEnabled ||
    state.discordRpcMode !== prev.discordRpcMode ||
    state.discordRpcShowButton !== prev.discordRpcShowButton ||
    state.discordRpcButtonText !== prev.discordRpcButtonText ||
    state.discordRpcYouTubeButtonText !== prev.discordRpcYouTubeButtonText ||
    state.discordRpcHidePaused !== prev.discordRpcHidePaused;

  if (!rpcSettingsChanged) return;

  if (!state.discordRpcEnabled) {
    if (seekSyncTimer) {
      clearTimeout(seekSyncTimer);
      seekSyncTimer = null;
    }
    void clearPresence().finally(() => {
      connected = false;
      void invoke('discord_disconnect').catch(() => undefined);
    });
    return;
  }

  const { currentTrack } = usePlayerStore.getState();
  if (currentTrack) {
    void updatePresence(currentTrack, Math.round(getCurrentTime()));
  }
});

// This intentionally receives native ticks even while the window is hidden.
// Discord's timestamp keeps running independently, so tying it to UI repaint
// notifications causes a visible drift after background playback or an A-B loop.
subscribePlaybackTime(() => {
  const { currentTrack, isPlaying } = usePlayerStore.getState();
  if (!currentTrack || !useSettingsStore.getState().discordRpcEnabled) return;

  if (!connected) {
    void updatePresence(currentTrack, Math.round(getCurrentTime()));
    return;
  }

  if (!isPlaying) return;

  const elapsed = Math.round(getCurrentTime());
  const drift = Math.abs(elapsed - lastElapsed);

  // Re-sync Discord timestamps on manual seek / large jumps without spamming updates every second.
  if (drift >= 2) {
    lastElapsed = elapsed;
    schedulePresenceSync(currentTrack, 180);
  } else {
    lastElapsed = elapsed;
  }

  // Периодический heartbeat: правит дрейф при буферизации/простоях, когда
  // позиция в Discord продолжает тикать, а фактическое время замерло.
  const now = Date.now();
  if (now - lastFullSyncAt >= HEARTBEAT_MS) {
    lastFullSyncAt = now;
    updatePresence(currentTrack, elapsed);
  }
});
