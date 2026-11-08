import { useTranslation } from 'react-i18next';
import type { SettingsCategory, SettingsCategoryId } from './registry';

/** Left rail — a sticky frosted panel of category pills, lit by the accent. */
export function SettingsNav({
  categories,
  active,
  onChange,
}: {
  categories: SettingsCategory[];
  active: SettingsCategoryId;
  onChange: (id: SettingsCategoryId) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav className="w-[212px] shrink-0 hidden md:block">
      <div className="sticky top-14 flex flex-col gap-0.5">
        {categories.map((c) => {
          const on = c.id === active;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
              className={`liquid-sidebar-item cursor-pointer text-left ${
                on ? 'liquid-sidebar-item--active' : ''
              }`}
            >
              <span className="w-6 h-6 shrink-0 flex items-center justify-center text-[var(--color-accent)]">
                {c.icon}
              </span>
              <span className="truncate">{t(c.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
