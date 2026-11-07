import { useTranslation } from 'react-i18next';
import { MessageCircle } from '../../../lib/icons';
import { type DiscordRpcMode, useSettingsStore } from '../../../stores/settings';
import { Card, Row, Segmented, Toggle } from '../primitives';

const MODES: Array<{ id: DiscordRpcMode; labelKey: string }> = [
  { id: 'track', labelKey: 'settings.discordRpcModeTrack' },
  { id: 'artist', labelKey: 'settings.discordRpcModeArtist' },
  { id: 'activity', labelKey: 'settings.discordRpcModeActivity' },
];

export function DiscordCard() {
  const { t } = useTranslation();
  const enabled = useSettingsStore((s) => s.discordRpcEnabled);
  const setEnabled = useSettingsStore((s) => s.setDiscordRpcEnabled);
  const mode = useSettingsStore((s) => s.discordRpcMode);
  const setMode = useSettingsStore((s) => s.setDiscordRpcMode);
  const showButton = useSettingsStore((s) => s.discordRpcShowButton);
  const setShowButton = useSettingsStore((s) => s.setDiscordRpcShowButton);
  const buttonText = useSettingsStore((s) => s.discordRpcButtonText);
  const setButtonText = useSettingsStore((s) => s.setDiscordRpcButtonText);
  const youtubeButtonText = useSettingsStore((s) => s.discordRpcYouTubeButtonText);
  const setYouTubeButtonText = useSettingsStore((s) => s.setDiscordRpcYouTubeButtonText);
  const hidePaused = useSettingsStore((s) => s.discordRpcHidePaused);
  const setHidePaused = useSettingsStore((s) => s.setDiscordRpcHidePaused);

  return (
    <Card
      title={t('settings.discordRpc')}
      desc={t('settings.discordRpcDesc')}
      icon={<MessageCircle size={17} />}
      action={<Toggle checked={enabled} onChange={() => setEnabled(!enabled)} />}
    >
      {enabled ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-[12.5px] text-white/50 font-medium">
              {t('settings.discordRpcMode')}
            </p>
            <Segmented
              value={mode}
              columns={3}
              onChange={setMode}
              options={MODES.map((m) => ({ id: m.id, label: t(m.labelKey) }))}
            />
          </div>
          <Row title={t('settings.discordRpcButton')} desc={t('settings.discordRpcButtonDesc')}>
            <Toggle checked={showButton} onChange={() => setShowButton(!showButton)} />
          </Row>
          {showButton && (
            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-[12.5px] text-white/50 font-medium">
                  {t('settings.discordRpcButtonText')}
                </span>
                <input
                  type="text"
                  value={buttonText}
                  maxLength={32}
                  onChange={(event) => setButtonText(event.target.value)}
                  placeholder={t('settings.discordRpcButtonTextPlaceholder')}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[12.5px] text-white/50 font-medium">
                  {t('settings.discordRpcYouTubeButtonText')}
                </span>
                <input
                  type="text"
                  value={youtubeButtonText}
                  maxLength={32}
                  onChange={(event) => setYouTubeButtonText(event.target.value)}
                  placeholder={t('settings.discordRpcYouTubeButtonTextPlaceholder')}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-[var(--color-accent)]"
                />
              </label>
              <p className="text-[11.5px] text-white/35">
                {t('settings.discordRpcButtonTextDesc')}
              </p>
            </div>
          )}
          <Row
            title={t('settings.discordRpcHidePaused')}
            desc={t('settings.discordRpcHidePausedDesc')}
          >
            <Toggle checked={hidePaused} onChange={() => setHidePaused(!hidePaused)} />
          </Row>
        </div>
      ) : null}
    </Card>
  );
}
