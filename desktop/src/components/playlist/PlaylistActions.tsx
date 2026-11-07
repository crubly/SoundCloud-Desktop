import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { fc } from '../../lib/formatters';
import type { Playlist } from '../../lib/hooks';
import {
  Check,
  LinkIcon,
  pauseCurrent16,
  Pin,
  playCurrent16,
  Shuffle,
  Star,
  Trash2,
} from '../../lib/icons';
import { SharingToggle } from '../music/SharingToggle';

const PlaylistLikeBtn = React.memo(function PlaylistLikeBtn({
  playlistUrn,
  count,
}: {
  playlistUrn: string;
  count?: number;
}) {
  const { t } = useTranslation();
  const { data: likeStatus } = useQuery({
    queryKey: ['likes', 'playlist', playlistUrn],
    queryFn: () => api<{ liked: boolean }>(`/likes/playlists/${encodeURIComponent(playlistUrn)}`),
    staleTime: 1000 * 60 * 5,
  });
  const [liked, setLiked] = useState(false);
  const [localCount, setLocalCount] = useState(count ?? 0);
  const qc = useQueryClient();
  const invalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (likeStatus) setLiked(likeStatus.liked);
  }, [likeStatus]);
  useEffect(() => setLocalCount(count ?? 0), [count]);
  useEffect(() => () => clearTimeout(invalidateTimer.current ?? undefined), []);

  const toggle = async () => {
    const next = !liked;
    setLiked(next);
    setLocalCount((c) => c + (next ? 1 : -1));
    try {
      await api(`/likes/playlists/${encodeURIComponent(playlistUrn)}`, {
        method: next ? 'POST' : 'DELETE',
      });
      invalidateTimer.current = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['likes', 'playlist', playlistUrn] });
        qc.invalidateQueries({ queryKey: ['me', 'likes', 'playlists'] });
      }, 3000);
    } catch {
      setLiked(!next);
      setLocalCount((c) => c + (next ? -1 : 1));
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={t('track.likes')}
      className={`liquid-action-btn h-10 px-3.5 rounded-full text-[12.5px] tabular-nums ${
        liked ? 'text-accent' : '!text-white/70 hover:!text-white'
      }`}
    >
      <Star size={14} fill={liked ? 'currentColor' : 'none'} />
      {localCount > 0 && <span>{fc(localCount)}</span>}
    </button>
  );
});

const CopyIconAction = React.memo(function CopyIconAction({ url }: { url?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(copyTimer.current ?? undefined), []);
  if (!url) return null;
  const copy = () => {
    try {
      const u = new URL(url);
      for (const p of ['utm_medium', 'utm_campaign', 'utm_source']) u.searchParams.delete(p);
      navigator.clipboard.writeText(u.toString().replace(/\?$/, ''));
    } catch {
      navigator.clipboard.writeText(url);
    }
    setCopied(true);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? t('auth.copied') : t('auth.copyLink')}
      aria-label={copied ? t('auth.copied') : t('auth.copyLink')}
      className={`liquid-action-btn w-10 h-10 rounded-full ${
        copied ? '!text-emerald-400' : '!text-white/70 hover:!text-white'
      }`}
    >
      {copied ? <Check size={15} /> : <LinkIcon size={15} />}
    </button>
  );
});

/** Apple Music Tahoe Playlist Action Row (Reference Image 3):
 *  Circular Shuffle button, Pill ▶ Play button, Circular Pin button + Like/Copy/Delete. */
export const PlaylistActions = React.memo(function PlaylistActions({
  playlist,
  isOwner,
  isPlaying,
  isPinned,
  onPlayAll,
  onShuffle,
  onTogglePin,
  onDelete,
}: {
  playlist: Playlist;
  isOwner: boolean;
  isPlaying: boolean;
  isPinned: boolean;
  onPlayAll: () => void;
  onShuffle: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3.5 flex-wrap">
      {/* 1. Circular Shuffle Button */}
      <button
        type="button"
        onClick={onShuffle}
        title={t('playlist.shuffle')}
        className="liquid-action-btn w-10 h-10 rounded-full"
      >
        <Shuffle size={16} strokeWidth={2.2} />
      </button>

      {/* 2. Pill Play / Pause Button */}
      <button
        type="button"
        onClick={onPlayAll}
        className="liquid-action-btn h-10 px-9 rounded-full text-[14px] font-semibold"
      >
        {isPlaying ? pauseCurrent16 : playCurrent16}
        <span>{isPlaying ? t('track.pause') : t('track.play')}</span>
      </button>

      {/* 3. Circular Pin Button */}
      <button
        type="button"
        onClick={onTogglePin}
        title={isPinned ? t('sidebar.unpinPlaylist') : t('sidebar.pinPlaylist')}
        aria-label={isPinned ? t('sidebar.unpinPlaylist') : t('sidebar.pinPlaylist')}
        className={`liquid-action-btn w-10 h-10 rounded-full ${
          isPinned ? 'ring-1 ring-accent/40' : ''
        }`}
      >
        <Pin size={16} strokeWidth={2.2} fill={isPinned ? 'currentColor' : 'none'} />
      </button>

      <PlaylistLikeBtn playlistUrn={playlist.urn} count={playlist.likes_count} />
      <CopyIconAction url={playlist.permalink_url} />

      {isOwner && (
        <div className="flex items-center gap-2">
          <SharingToggle kind="playlist" urn={playlist.urn} sharing={playlist.sharing} />
          <button
            type="button"
            onClick={onDelete}
            title={t('playlist.delete')}
            aria-label={t('playlist.delete')}
            className="liquid-action-btn w-10 h-10 rounded-full !text-white/60 hover:!text-red-400"
          >
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </div>
  );
});
