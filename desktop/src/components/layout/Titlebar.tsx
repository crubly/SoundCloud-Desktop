import { getCurrentWindow } from '@tauri-apps/api/window';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Fullscreen,
  Minus,
  MoreHorizontal,
  Square,
  X,
} from '../../lib/icons';
import { isMac } from '../../lib/platform';
import { toggleWindowFullscreen } from '../../lib/window';
import { GlobalSearch } from './GlobalSearch';

const pillBtnCls =
  'w-7 h-7 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer disabled:opacity-25 disabled:cursor-default text-white/65 hover:text-white hover:bg-white/[0.1] active:scale-90';

const NavButtons = React.memo(() => {
  const navigate = useNavigate();
  const location = useLocation();
  const canGoBack = location.key !== 'default';

  return (
    <div className="liquid-pill h-8 px-1 rounded-full flex items-center gap-0.5 pointer-events-auto">
      <button
        type="button"
        disabled={!canGoBack}
        onClick={() => navigate(-1)}
        className={pillBtnCls}
        aria-label="Back"
      >
        <ChevronLeft size={16} strokeWidth={2.3} />
      </button>
      <div className="w-px h-3.5 bg-white/[0.1]" />
      <button type="button" onClick={() => navigate(1)} className={pillBtnCls} aria-label="Forward">
        <ChevronRight size={16} strokeWidth={2.3} />
      </button>
    </div>
  );
});

const WinButton = ({
  onClick,
  danger,
  label,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  label: string;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className={`w-8 h-7 rounded-full flex items-center justify-center text-white/55 transition-all duration-150 cursor-pointer ${
      danger ? 'hover:text-white hover:bg-red-500/80' : 'hover:text-white hover:bg-white/[0.1]'
    }`}
  >
    {children}
  </button>
);

export const Titlebar = React.memo(({ onOpenKeybindings }: { onOpenKeybindings?: () => void }) => {
  const { t } = useTranslation();
  const win = getCurrentWindow();
  const mac = isMac();

  return (
    <header
      className="absolute top-0 left-0 right-0 z-40 h-14 flex items-center justify-between gap-3 px-6 select-none pointer-events-none"
      data-tauri-drag-region
    >
      {/* Full-width invisible drag strip */}
      <div className="absolute inset-0 pointer-events-auto" data-tauri-drag-region />

      {/* LEFT: Floating Liquid Glass Back / Forward Pill */}
      <div className="relative z-10 flex items-center gap-2">
        <NavButtons />
      </div>

      {/* RIGHT: Floating Action Pill [••• | Fullscreen] + Search Pill + Windows Controls Pill */}
      <div className="relative z-10 flex items-center gap-2.5 pointer-events-auto">
        <div className="liquid-pill h-8 px-1.5 rounded-full flex items-center gap-0.5">
          {onOpenKeybindings && (
            <button
              type="button"
              onClick={onOpenKeybindings}
              title={t('kb.title')}
              className={pillBtnCls}
            >
              <MoreHorizontal size={15} />
            </button>
          )}
          <div className="w-px h-3.5 bg-white/[0.1]" />
          <button
            type="button"
            onClick={() => void toggleWindowFullscreen()}
            title={t('kb.fullscreen')}
            className={pillBtnCls}
          >
            <Fullscreen size={13} />
          </button>
        </div>

        <GlobalSearch />

        {!mac && (
          <div className="liquid-pill h-8 px-1 rounded-full flex items-center gap-0.5">
            <WinButton onClick={() => win.minimize()} label="Minimize">
              <Minus size={14} />
            </WinButton>
            <WinButton onClick={() => win.toggleMaximize()} label="Maximize">
              <Square size={11} />
            </WinButton>
            <WinButton onClick={() => win.close()} danger label="Close">
              <X size={14} />
            </WinButton>
          </div>
        )}
      </div>
    </header>
  );
});
