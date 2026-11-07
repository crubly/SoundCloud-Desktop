import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/shallow';
import { changeAppLanguage } from '../../i18n';
import { art } from '../../lib/formatters';
import {
  ChevronDown,
  Clock,
  Disc3,
  Globe,
  Home,
  LayoutGrid,
  ListMusic,
  MicVocal,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Radio,
  Search,
  Settings,
  Star,
} from '../../lib/icons';
import { usePerfMode } from '../../lib/perf';
import { isMac } from '../../lib/platform';
import { useAppMode } from '../../stores/app-status';
import { useAuthStore } from '../../stores/auth';
import { useSettingsStore } from '../../stores/settings';

type IconCmp = React.ComponentType<{
  size?: number;
  strokeWidth?: number;
  className?: string;
  fill?: string;
}>;

const languages = [
  { code: 'en', label: 'EN' },
  { code: 'ru', label: 'RU' },
  { code: 'tr', label: 'TR' },
] as const;

const LABEL_T = 'max-width 280ms cubic-bezier(0.2,0.8,0.2,1), opacity 200ms ease';

function Label({
  collapsed,
  children,
  className,
}: {
  collapsed: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`overflow-hidden whitespace-nowrap truncate ${className ?? ''}`}
      style={{ maxWidth: collapsed ? 0 : '152px', opacity: collapsed ? 0 : 1, transition: LABEL_T }}
    >
      {children}
    </span>
  );
}

function IconBox({ children, accent = true }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className="w-6 h-6 shrink-0 flex items-center justify-center transition-colors"
      style={accent ? { color: 'var(--color-accent)' } : undefined}
    >
      {children}
    </span>
  );
}

function SidebarNavRow({
  to,
  icon: Icon,
  label,
  collapsed,
  end,
  isActiveOverride,
  alert,
}: {
  to: string;
  icon: IconCmp;
  label: string;
  collapsed: boolean;
  end?: boolean;
  isActiveOverride?: boolean;
  alert?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) => {
        const active = isActiveOverride !== undefined ? isActiveOverride : isActive;
        return `liquid-sidebar-item ${
          active
            ? 'liquid-sidebar-item--active'
            : alert
              ? 'bg-accent/10 ring-1 ring-accent/25 text-white'
              : ''
        } ${collapsed ? 'justify-center !px-0' : ''}`;
      }}
    >
      <IconBox>
        <Icon size={17} strokeWidth={2} />
      </IconBox>
      {!collapsed && <Label collapsed={collapsed}>{label}</Label>}
    </NavLink>
  );
}

export const Sidebar = React.memo(() => {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const appMode = useAppMode();
  const user = useAuthStore((s) => s.user);
  const { collapsed, pinnedPlaylists, toggleSidebar } = useSettingsStore(
    useShallow((s) => ({
      collapsed: s.sidebarCollapsed,
      pinnedPlaylists: s.pinnedPlaylists,
      toggleSidebar: s.toggleSidebar,
    })),
  );
  const perf = usePerfMode();
  const [pinsExpanded, setPinsExpanded] = useState(true);
  const mac = isMac();

  const toggleLanguage = () => {
    void changeAppLanguage(i18n.language === 'ru' ? 'en' : 'ru');
  };
  const currentLang = languages.find((l) => l.code === i18n.language) ?? languages[0];
  const userAvatar = art(user?.avatar_url, 'small');

  const isDiscoverTab = (tab: string) =>
    location.pathname === '/discover' && location.search.includes(`tab=${tab}`);
  const isDiscoverMain =
    location.pathname === '/discover' &&
    !location.search.includes('tab=artists') &&
    !location.search.includes('tab=albums');
  const isAllPlaylists =
    location.pathname === '/library' && location.search.includes('tab=playlists');
  const isSongsLibrary =
    location.pathname === '/library' && !location.search.includes('tab=playlists');

  return (
    <aside
      className="hidden md:flex shrink-0 flex-col h-full overflow-hidden liquid-sidebar select-none transition-[width] duration-300 ease-[var(--ease-apple)]"
      style={{
        width: collapsed ? 64 : 228,
        transitionDuration: perf.mode === 'light' ? '0ms' : undefined,
      }}
    >
      {/* Top Header Bar: reserves space on macOS for native traffic lights (🔴 🟡 🟢) */}
      <div
        className={`h-13 shrink-0 flex items-center justify-between px-3 ${
          mac && !collapsed ? 'pl-[78px]' : ''
        }`}
        data-tauri-drag-region
      >
        {!collapsed && <div className="flex-1 h-full" data-tauri-drag-region />}
        <button
          type="button"
          onClick={toggleSidebar}
          title={collapsed ? t('nav.expand') : t('nav.collapse')}
          className={`w-7 h-7 rounded-lg flex items-center justify-center text-white/45 hover:text-white/90 hover:bg-white/[0.08] transition-colors cursor-pointer ${
            mac && collapsed ? 'mt-6 mx-auto' : ''
          }`}
        >
          {collapsed ? (
            <PanelLeftOpen size={16} strokeWidth={1.9} />
          ) : (
            <PanelLeftClose size={16} strokeWidth={1.9} />
          )}
        </button>
      </div>

      {/* Scrollable Navigation Body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide px-2.5 pb-3 space-y-4">
        {/* Top Primary Section: Search, Home, New, Radio */}
        <nav className="flex flex-col gap-0.5 pt-1">
          <SidebarNavRow
            to="/search"
            icon={Search}
            label={t('nav.search')}
            collapsed={collapsed}
          />
          <SidebarNavRow to="/home" icon={Home} label={t('nav.home')} collapsed={collapsed} />
          <SidebarNavRow
            to="/discover"
            icon={LayoutGrid}
            label={t('sidebar.new')}
            collapsed={collapsed}
            isActiveOverride={isDiscoverMain}
          />
          <SidebarNavRow
            to="/home#wave"
            icon={Radio}
            label={t('sidebar.radio')}
            collapsed={collapsed}
            isActiveOverride={location.pathname === '/home' && location.hash === '#wave'}
          />
        </nav>

        {/* Library Section */}
        <div className="space-y-0.5">
          {!collapsed && (
            <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-tight text-white/40">
              {t('nav.library')}
            </div>
          )}

          {/* Collapsible Pins group (Reference Image 2 & 3) */}
          {!collapsed && (
            <div>
              <button
                type="button"
                onClick={() => setPinsExpanded((v) => !v)}
                className="liquid-sidebar-item cursor-pointer group/pin"
              >
                <ChevronDown
                  size={12}
                  className={` -ml-1 text-white/35 transition-transform duration-200 ${
                    pinsExpanded ? 'rotate-0' : '-rotate-90'
                  }`}
                />
                <IconBox>
                  <Pin size={16} strokeWidth={2} />
                </IconBox>
                <Label collapsed={collapsed}>{t('sidebar.pins')}</Label>
              </button>

              {pinsExpanded && pinnedPlaylists.length > 0 && (
                <div className="pl-5 pr-1 py-0.5 space-y-0.5">
                  {pinnedPlaylists.map((playlist) => {
                    const artwork = art(playlist.artworkUrl, 'small');
                    return (
                      <NavLink
                        key={playlist.urn}
                        to={`/playlist/${encodeURIComponent(playlist.urn)}`}
                        className={({ isActive }) =>
                          `liquid-sidebar-item !py-1.5 !px-2 ${
                            isActive ? 'liquid-sidebar-item--active' : ''
                          }`
                        }
                      >
                        <span className="w-[22px] h-[22px] rounded-[5px] overflow-hidden shrink-0 bg-white/[0.06] ring-1 ring-white/[0.12] flex items-center justify-center">
                          {artwork ? (
                            <img
                              src={artwork}
                              alt=""
                              className="w-full h-full object-cover"
                              decoding="async"
                              loading="lazy"
                            />
                          ) : (
                            <ListMusic size={13} className="text-white/50" />
                          )}
                        </span>
                        <span className="text-[12.5px] font-medium text-white/85 truncate">
                          {playlist.title}
                        </span>
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <SidebarNavRow
            to="/offline"
            icon={Clock}
            label={t('sidebar.recentlyAdded')}
            collapsed={collapsed}
            alert={appMode !== 'online'}
          />
          <SidebarNavRow
            to="/discover?tab=artists"
            icon={MicVocal}
            label={t('sidebar.artists')}
            collapsed={collapsed}
            isActiveOverride={isDiscoverTab('artists')}
          />
          <SidebarNavRow
            to="/discover?tab=albums"
            icon={Disc3}
            label={t('sidebar.albums')}
            collapsed={collapsed}
            isActiveOverride={isDiscoverTab('albums')}
          />
          <SidebarNavRow
            to="/library"
            icon={Music}
            label={t('sidebar.songs')}
            collapsed={collapsed}
            end
            isActiveOverride={isSongsLibrary}
          />
        </div>

        {/* Playlists Section (Reference Image 2 & 3) */}
        <div className="space-y-0.5">
          {!collapsed && (
            <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-tight text-white/40">
              {t('sidebar.playlists')}
            </div>
          )}

          <SidebarNavRow
            to="/library?tab=playlists"
            icon={LayoutGrid}
            label={t('sidebar.allPlaylists')}
            collapsed={collapsed}
            isActiveOverride={isAllPlaylists}
          />

          {/* Favourite Songs with iconic white rounded square + accent Star ★ */}
          <NavLink
            to="/library/likes"
            title={collapsed ? t('sidebar.favouriteSongs') : undefined}
            className={({ isActive }) =>
              `liquid-sidebar-item ${isActive ? 'liquid-sidebar-item--active' : ''} ${
                collapsed ? 'justify-center !px-0' : ''
              }`
            }
          >
            <span className="w-[22px] h-[22px] rounded-[6px] bg-white shrink-0 flex items-center justify-center shadow-[0_2px_6px_rgba(0,0,0,0.35)]">
              <Star
                size={13}
                fill="var(--color-accent)"
                strokeWidth={0}
                className="text-accent"
              />
            </span>
            {!collapsed && <Label collapsed={collapsed}>{t('sidebar.favouriteSongs')}</Label>}
          </NavLink>
        </div>
      </div>

      {/* Bottom Dock: Iridescent User Orb + Quick Settings Liquid Pill (Reference Images 1, 2, 3) */}
      <div
        className={`px-3 pb-3 pt-2 flex items-center ${
          collapsed ? 'flex-col gap-2 justify-center' : 'justify-between gap-2'
        }`}
      >
        <button
          type="button"
          onClick={() => navigate(user?.urn ? `/user/${encodeURIComponent(user.urn)}` : '/settings')}
          title={user?.username || t('nav.settings')}
          className="relative w-8 h-8 rounded-full shrink-0 overflow-hidden cursor-pointer transition-transform duration-200 hover:scale-105 active:scale-95 shadow-[0_4px_14px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.45)]"
          style={{
            background:
              'radial-gradient(circle at 30% 25%, #dbeafe 0%, #93c5fd 35%, #6366f1 75%, #312e81 100%)',
          }}
        >
          {userAvatar ? (
            <img src={userAvatar} alt="" className="w-full h-full object-cover" />
          ) : null}
          <span className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/30 pointer-events-none" />
        </button>

        <div
          className={`flex items-center rounded-full liquid-pill p-0.5 ${
            collapsed ? 'flex-col' : 'gap-0.5'
          }`}
        >
          <button
            type="button"
            onClick={toggleLanguage}
            title={currentLang.label}
            className="h-7 px-2 rounded-full flex items-center justify-center gap-1 text-[11px] font-semibold text-white/65 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <Globe size={13} />
            {!collapsed && <span>{currentLang.label}</span>}
          </button>
          <NavLink
            to="/settings"
            title={t('nav.settings')}
            className={({ isActive }) =>
              `w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                isActive
                  ? 'bg-white/18 text-white'
                  : 'text-white/65 hover:text-white hover:bg-white/[0.08]'
              }`
            }
          >
            <Settings size={14} />
          </NavLink>
        </div>
      </div>
    </aside>
  );
});
