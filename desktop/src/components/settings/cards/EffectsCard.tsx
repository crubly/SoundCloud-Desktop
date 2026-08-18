import { useTranslation } from 'react-i18next';
import { AudioLines } from '../../../lib/icons';
import { useSettingsStore } from '../../../stores/settings';
import { Card, Divider, RangeSlider, Segmented } from '../primitives';

export function EffectsCard() {
  const { t } = useTranslation();
  const audioEffect = useSettingsStore((s) => s.audioEffect);
  const setAudioEffect = useSettingsStore((s) => s.setAudioEffect);
  const stereoWidth = useSettingsStore((s) => s.stereoWidth);
  const setStereoWidth = useSettingsStore((s) => s.setStereoWidth);

  return (
    <Card title={t('settings.effects')} icon={<AudioLines size={17} />}>
      <div className="space-y-4">
        <div className="space-y-3">
          <div>
            <p className="text-[13px] text-white/60 font-medium">
              {t('settings.effectsAudioEffect')}
            </p>
            <p className="text-[11px] text-white/30 mt-0.5">
              {t('settings.effectsAudioEffectDesc')}
            </p>
          </div>
          <Segmented
            value={audioEffect}
            onChange={setAudioEffect}
            columns={3}
            options={[
              { id: 'off', label: t('settings.effectsOff') },
              { id: 'nightcore', label: t('settings.effectsNightcore') },
              { id: 'vaporwave', label: t('settings.effectsVaporwave') },
            ]}
          />
        </div>

        <Divider />

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] text-white/60 font-medium">
                {t('settings.effectsStereoWidth')}
              </p>
              <p className="text-[11px] text-white/30 mt-0.5">
                {t('settings.effectsStereoWidthDesc')}
              </p>
            </div>
            <span className="text-[12px] text-white/30 tabular-nums">
              {stereoWidth.toFixed(2)}×
            </span>
          </div>
          <RangeSlider value={stereoWidth} min={0} max={2} step={0.05} onChange={setStereoWidth} />
          <div className="flex justify-between text-[10px] font-medium uppercase tracking-wider text-white/25">
            <span>{t('settings.effectsMono')}</span>
            <span>{t('settings.effectsWide')}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
