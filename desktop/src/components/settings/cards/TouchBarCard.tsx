import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { GripVertical, Laptop } from '../../../lib/icons';
import {
  type TouchBarElementId,
  type TouchBarMode,
  useSettingsStore,
} from '../../../stores/settings';
import { Card, Divider, Row, Segmented, Toggle } from '../primitives';

const ELEMENT_LABEL_KEYS: Record<TouchBarElementId, string> = {
  cover: 'settings.touchBarElementCover',
  info: 'settings.touchBarElementInfo',
  lyrics: 'settings.touchBarElementLyrics',
  prev: 'settings.touchBarElementPrev',
  play: 'settings.touchBarElementPlay',
  next: 'settings.touchBarElementNext',
};

const MODE_OPTIONS: ReadonlyArray<{ id: TouchBarMode; label: string }> = [
  { id: 'active', label: 'settings.touchBarModeActive' },
  { id: 'always', label: 'settings.touchBarModeAlways' },
  { id: 'overall', label: 'settings.touchBarModeOverall' },
];

function SortableElementRow({
  id,
  enabled,
  disabled,
  onToggle,
}: {
  id: TouchBarElementId;
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 px-2.5 py-1.5 rounded-xl border border-white/[0.05] ${
        isDragging ? 'bg-white/[0.08] ring-1 ring-white/10 opacity-70' : 'bg-white/[0.03]'
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="w-6 h-6 shrink-0 flex items-center justify-center text-white/25 cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical size={14} />
      </div>
      <span className="flex-1 min-w-0 text-[13px] text-white/75 font-medium">
        {t(ELEMENT_LABEL_KEYS[id])}
      </span>
      <Toggle checked={enabled} onChange={onToggle} disabled={disabled} />
    </div>
  );
}

export function TouchBarCard() {
  const { t } = useTranslation();
  const touchBar = useSettingsStore((s) => s.touchBar);
  const setTouchBar = useSettingsStore((s) => s.setTouchBar);
  const mode = useSettingsStore((s) => s.touchBarMode);
  const setMode = useSettingsStore((s) => s.setTouchBarMode);
  const elements = useSettingsStore((s) => s.touchBarElements);
  const setElements = useSettingsStore((s) => s.setTouchBarElements);
  const lyricsAlways = useSettingsStore((s) => s.touchBarLyricsAlways);
  const setLyricsAlways = useSettingsStore((s) => s.setTouchBarLyricsAlways);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const itemIds = elements.map((e) => e.id);

  const onDragEnd = ({
    active,
    over,
  }: {
    active: { id: unknown };
    over: { id: unknown } | null;
  }) => {
    if (!over || active.id === over.id) return;
    const oldIdx = elements.findIndex((e) => e.id === active.id);
    const newIdx = elements.findIndex((e) => e.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = [...elements];
    const [moved] = next.splice(oldIdx, 1);
    next.splice(newIdx, 0, moved);
    setElements(next);
  };

  const toggleElement = (id: TouchBarElementId) => {
    setElements(elements.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)));
  };

  return (
    <Card
      title={t('settings.touchBar')}
      desc={t('settings.touchBarDesc')}
      icon={<Laptop size={17} />}
    >
      <div className="space-y-5">
        <Row title={t('settings.touchBarEnabled')}>
          <Toggle checked={touchBar} onChange={() => setTouchBar(!touchBar)} />
        </Row>

        <div>
          <p className="text-[12px] uppercase tracking-[0.16em] text-white/30 font-bold mb-2">
            {t('settings.touchBarMode')}
          </p>
          <Segmented
            value={mode}
            options={MODE_OPTIONS.map((o) => ({ id: o.id, label: t(o.label) }))}
            onChange={setMode}
          />
          {mode === 'overall' && (
            <p className="text-[11.5px] text-white/30 mt-2 leading-snug">
              {t('settings.touchBarOverallNote')}
            </p>
          )}
        </div>

        <Divider />

        <div>
          <p className="text-[12px] uppercase tracking-[0.16em] text-white/30 font-bold mb-1">
            {t('settings.touchBarElements')}
          </p>
          <p className="text-[11.5px] text-white/35 mb-3 leading-snug">
            {t('settings.touchBarElementsDesc')}
          </p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-1.5">
                {elements.map((e) => (
                  <SortableElementRow
                    key={e.id}
                    id={e.id}
                    enabled={e.enabled}
                    disabled={!touchBar}
                    onToggle={() => toggleElement(e.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <Divider />

        <Row
          title={t('settings.touchBarLyricsAlways')}
          desc={t('settings.touchBarLyricsAlwaysDesc')}
        >
          <Toggle
            checked={lyricsAlways}
            onChange={() => setLyricsAlways(!lyricsAlways)}
            disabled={!touchBar}
          />
        </Row>
      </div>
    </Card>
  );
}
