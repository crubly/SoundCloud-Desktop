import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Clock, Search as SearchIcon, X } from '../../lib/icons';
import { usePerfMode } from '../../lib/perf';
import { useSearchHistoryStore } from '../../stores/searchHistory';
import { useSearchQueryStore } from '../../stores/searchQuery';
import { isSoundCloudUrl, isYouTubeUrl } from '../search/utils';

/* Compact floating Liquid Glass search pill in the top-right corner (Apple Music Tahoe style).
 * Expands smoothly when focused and opens recent search history in a Liquid Glass popover. */
export const GlobalSearch = memo(function GlobalSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const q = useSearchQueryStore((s) => s.q);
  const setQ = useSearchQueryStore((s) => s.setQ);
  const history = useSearchHistoryStore((s) => s.queries);
  const removeQuery = useSearchHistoryStore((s) => s.removeQuery);
  const clearHistory = useSearchHistoryStore((s) => s.clearHistory);

  const perf = usePerfMode();
  const dropBlur = perf.blur(32);

  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUrl = isSoundCloudUrl(q) || isYouTubeUrl(q);
  const showHistory = focused && q.trim() === '' && history.length > 0;

  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    [],
  );

  const goSearch = () => {
    if (location.pathname !== '/search') navigate('/search');
  };
  const change = (v: string) => {
    setQ(v);
    if (v) goSearch();
  };
  const pick = (value: string) => {
    setQ(value);
    goSearch();
  };

  return (
    <div
      className={`relative transition-[width] duration-300 ease-[var(--ease-apple)] ${
        focused || q ? 'w-[280px] sm:w-[320px]' : 'w-[196px] sm:w-[220px]'
      }`}
      style={{ isolation: 'isolate' }}
    >
      <div
        className="liquid-pill relative flex items-center gap-2 h-8 pl-3 pr-2 rounded-full overflow-hidden"
        style={
          focused
            ? {
                borderColor: 'rgba(255,255,255,0.28)',
                boxShadow:
                  'inset 0 1px 0.5px rgba(255,255,255,0.34), 0 12px 32px rgba(0,0,0,0.7), 0 0 18px var(--color-accent-glow)',
              }
            : undefined
        }
      >
        <SearchIcon
          size={14}
          className="shrink-0 transition-colors duration-200"
          style={{ color: focused ? 'var(--color-accent)' : 'rgba(255,255,255,0.5)' }}
        />
        <input
          id="global-search-input"
          value={q}
          onChange={(e) => change(e.target.value)}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
            setFocused(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setFocused(false), 150);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              goSearch();
              (e.currentTarget as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          placeholder={t('search.globalPlaceholder')}
          spellCheck={false}
          className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] font-medium text-white/92 placeholder:text-white/42 select-text"
        />
        {isUrl && (
          <span className="shrink-0 text-[9px] uppercase tracking-wide text-accent px-1.5 py-0.5 rounded-full bg-accent/15 border border-accent/25">
            {t('search.urlHint')}
          </span>
        )}
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-white/45 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label={t('search.clear')}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {showHistory && (
        <div
          className="absolute right-0 w-[280px] mt-2 p-1.5 rounded-2xl overflow-hidden z-50"
          style={{
            background: dropBlur > 0 ? 'rgba(18,18,22,0.84)' : 'rgba(18,18,22,0.96)',
            border: '1px solid rgba(255,255,255,0.14)',
            backdropFilter: dropBlur > 0 ? `blur(${dropBlur}px) saturate(190%)` : undefined,
            WebkitBackdropFilter: dropBlur > 0 ? `blur(${dropBlur}px) saturate(190%)` : undefined,
            boxShadow:
              '0 24px 60px rgba(0,0,0,0.75), inset 0 1px 0.5px rgba(255,255,255,0.22)',
          }}
        >
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-white/35">
              {t('search.history')}
            </span>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                clearHistory();
              }}
              className="text-[11px] text-white/40 hover:text-white/80 transition-colors cursor-pointer"
            >
              {t('search.clearHistory')}
            </button>
          </div>
          {history.slice(0, 8).map((item) => (
            <div
              key={item}
              className="group/h flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-white/[0.08] transition-colors cursor-pointer"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
            >
              <Clock size={12} className="shrink-0 text-white/30" />
              <span className="flex-1 min-w-0 truncate text-[12.5px] text-white/80">{item}</span>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  removeQuery(item);
                }}
                className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-white/0 group-hover/h:text-white/45 hover:!text-white transition-colors"
                aria-label={t('search.clear')}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
