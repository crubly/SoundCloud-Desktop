import type { LyricLine } from './lyrics';

export const PAUSE_MARKER = '♪♪♪';
const PAUSE_GAP_THRESHOLD = 4.5; // seconds — when to insert ♪♪♪

export type DisplayLine = LyricLine & { pause?: boolean; duration?: number; end?: number };

export function buildDisplayLines(lines: LyricLine[]): DisplayLine[] {
  if (!lines.length) return [];
  const out: DisplayLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const prev = lines[i - 1];
    if (prev) {
      const gap = cur.time - prev.time;
      if (gap >= PAUSE_GAP_THRESHOLD) {
        out.push({
          time: prev.time + 0.5,
          text: PAUSE_MARKER,
          pause: true,
          duration: gap - 0.6,
        });
      }
    } else if (cur.time >= PAUSE_GAP_THRESHOLD) {
      out.push({
        time: 0.05,
        text: PAUSE_MARKER,
        pause: true,
        duration: Math.max(0.5, cur.time - 0.1),
      });
    }
    out.push(cur);
  }
  // Karaoke span: each verse fills up to the NEXT verse start, ignoring ♪♪♪
  // markers, so a line never "completes" in the short run-up to an instrumental
  // break — it fills across the break and lands on 100% exactly when singing
  // resumes. (Backwards pass: end = time of the next later real verse.)
  let nextRealTime: number | null = null;
  for (let i = out.length - 1; i >= 0; i--) {
    const line = out[i];
    if (line.pause) continue;
    line.end = nextRealTime ?? line.time + 2.6;
    nextRealTime = line.time;
  }
  return out;
}

export interface TimelineLine {
  timeSecs: number;
  text: string | null;
  endSecs: number | null;
  /** Instrumental-break marker (♪♪♪) — the Touch Bar holds the prev verse instead. */
  pause?: boolean;
}

/** The exact payload Rust's `audio_set_lyrics_timeline` expects. */
export function toTimelineLines(lines: LyricLine[]): TimelineLine[] {
  return buildDisplayLines(lines).map((line) => ({
    timeSecs: line.time,
    text: line.text ?? null,
    endSecs: line.end ?? null,
    pause: !!line.pause,
  }));
}
