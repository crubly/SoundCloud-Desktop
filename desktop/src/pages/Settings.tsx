import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SETTINGS_CATEGORIES, type SettingsCategoryId } from '../components/settings/registry';
import { SettingsFrame } from '../components/settings/SettingsFrame';
import { SettingsNav } from '../components/settings/SettingsNav';
import { useTouchBarSupported } from '../lib/touchbar';
import { useViewerAura } from '../lib/useViewerAura';

/** Settings — a star-lit two-pane workspace: a frosted category rail on the
 *  left, the active category's cards on the right. Thin shell; each section is
 *  its own small card under components/settings/. */
export function Settings() {
  const { t } = useTranslation();
  const aura = useViewerAura();
  const touchBarSupported = useTouchBarSupported();
  const [active, setActive] = useState<SettingsCategoryId>('general');
  // The Touch Bar tab only exists on hardware that actually has one.
  const categories = SETTINGS_CATEGORIES.filter((c) =>
    c.id === 'touchbar' ? touchBarSupported : true,
  );
  const category = categories.find((c) => c.id === active) ?? categories[0];
  const Body = category.Body;

  return (
    <SettingsFrame aura={aura}>
      <div className="max-w-[1080px] mx-auto px-6 md:px-8 pt-14 pb-32 flex gap-8">
        <SettingsNav categories={categories} active={active} onChange={setActive} />
        <div className="flex-1 min-w-0">
          <h1 className="text-[32px] font-bold tracking-tight leading-none text-white mb-7">
            {t(category.labelKey)}
          </h1>
          <div key={active} className="space-y-5 animate-fade-in-up">
            <Body />
          </div>
        </div>
      </div>
    </SettingsFrame>
  );
}
