import { useTranslation } from 'react-i18next';
import { SlidersHorizontal } from '../../../lib/icons';
import { BAR_ELEMENT_KEYS, type BarElements, useSettingsStore } from '../../../stores/settings';
import { Card, Row, Toggle } from '../primitives';

export function BarCard() {
  const { t } = useTranslation();
  const barElements = useSettingsStore((s) => s.barElements);
  const setBarElement = useSettingsStore((s) => s.setBarElement);

  return (
    <Card
      title={t('settings.bar')}
      desc={t('settings.barDesc')}
      icon={<SlidersHorizontal size={17} />}
    >
      <div className="divide-y divide-white/[0.05]">
        {BAR_ELEMENT_KEYS.map((key) => (
          <Row key={key} title={t(`settings.bar_${key}`)} desc={t(`settings.bar_${key}Desc`)}>
            <Toggle
              checked={barElements[key as keyof BarElements]}
              onChange={() =>
                setBarElement(key as keyof BarElements, !barElements[key as keyof BarElements])
              }
            />
          </Row>
        ))}
      </div>
    </Card>
  );
}
