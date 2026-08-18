import { Cloud, Sparkles, Type } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Youtube } from '../../lib/icons';
import { useSearchPrefsStore } from '../../stores/searchPrefs';

/* The search-page control row: Text / Vibe mode + the live-source toggles
 * (SoundCloud, YouTube). The query itself lives in the global header field —
 * this is just how the current query is interpreted. */
export const SearchControls = memo(function SearchControls() {
  const { t } = useTranslation();
  const mode = useSearchPrefsStore((s) => s.mode);
  const setMode = useSearchPrefsStore((s) => s.setMode);
  const source = useSearchPrefsStore((s) => s.source);
  const setSource = useSearchPrefsStore((s) => s.setSource);

  const pickMode = (m: 'text' | 'vibe') => {
    setMode(m);
    setSource('db');
  };

  return (
    <div className="flex items-center justify-center gap-1.5">
      <div
        className={`flex items-center gap-0.5 p-0.5 rounded-full bg-white/[0.04] border border-white/10 transition-opacity duration-300 ${
          source !== 'db' ? 'opacity-40' : ''
        }`}
      >
        <Pill
          active={mode === 'text' && source === 'db'}
          onClick={() => pickMode('text')}
          icon={<Type size={13} />}
          label={t('search.mode.text')}
        />
        <Pill
          active={mode === 'vibe' && source === 'db'}
          onClick={() => pickMode('vibe')}
          icon={<Sparkles size={13} />}
          label={t('search.mode.vibe')}
        />
      </div>
      <SourcePill
        active={source === 'sc'}
        onClick={() => setSource(source === 'sc' ? 'db' : 'sc')}
        title={t('search.source.scHint')}
        icon={<Cloud size={13} />}
        label={t('search.source.sc')}
      />
      <SourcePill
        active={source === 'yt'}
        onClick={() => setSource(source === 'yt' ? 'db' : 'yt')}
        title={t('search.source.ytHint')}
        icon={<Youtube size={13} />}
        label={t('search.source.yt')}
      />
    </div>
  );
});

function SourcePill({
  active,
  onClick,
  title,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-full text-[12px] font-medium transition-all duration-300 cursor-pointer"
      style={
        active
          ? {
              color: '#fff',
              background:
                'linear-gradient(180deg, var(--color-accent-glow), transparent), rgba(255,255,255,0.04)',
              border: '0.5px solid var(--color-accent)',
              boxShadow:
                '0 0 16px var(--color-accent-glow), inset 0 0.5px 0 rgba(255,255,255,0.12)',
            }
          : {
              color: 'rgba(255,255,255,0.45)',
              background: 'rgba(255,255,255,0.04)',
              border: '0.5px solid rgba(255,255,255,0.1)',
            }
      }
    >
      {icon}
      {label}
    </button>
  );
}

function Pill({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-medium transition-all duration-300 cursor-pointer"
      style={
        active
          ? {
              color: '#fff',
              background:
                'linear-gradient(180deg, var(--color-accent-glow), transparent), rgba(255,255,255,0.04)',
              boxShadow:
                '0 0 16px var(--color-accent-glow), inset 0 0.5px 0 rgba(255,255,255,0.12)',
            }
          : { color: 'rgba(255,255,255,0.45)' }
      }
    >
      {icon}
      {label}
    </button>
  );
}
