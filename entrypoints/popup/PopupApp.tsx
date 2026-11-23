import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ComponentType, CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { useState } from 'react';
import { useI18n } from '../../core/i18n/use-i18n';
import { Button } from '../../core/ui/Button';
import { ModuleBadge } from '../../core/ui/ModuleIcon';
import { ModuleSurface } from '../../core/ui/ModuleSurface';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBox,
  IconGripVertical,
  IconPlus,
  IconSettings,
  IconTrash,
  IconWorkbench,
  IconZap,
} from '../../core/ui/icons';
import styles from './PopupApp.module.css';

export interface PopupModule {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly Surface?: ComponentType | null;
  readonly loadFailed?: boolean;
}

export interface PopupAppProps {
  readonly modules: readonly PopupModule[];
  readonly quickModuleIds: readonly string[];
  readonly lastQuickModuleId: string | null;
  readonly workbenchHref: string;
  readonly optionsHref: string;
  readonly onSelect: (id: string) => void;
  readonly onAdd: (id: string) => void;
  readonly onRemove: (id: string) => void;
  readonly onMove: (id: string, direction: 'left' | 'right') => void;
  readonly onReorder: (id: string, toIndex: number) => void;
}

// The action popup is 380px wide: a translated tab adds scrollable overflow
// to the strip, and dnd-kit autoScroll then scrolls the row out from under an
// edge-ward drag, swallowing the gesture. Lock movement to the strip's axis so
// the tab stays inside the row it reorders.
const lockToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

export function PopupApp(props: PopupAppProps): ReactElement {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const byId = new Map(props.modules.map((module) => [module.id, module]));
  const quick = props.quickModuleIds
    .map((id) => byId.get(id))
    .filter((module): module is PopupModule => module !== undefined && module.enabled);
  const selected =
    quick.find((module) => module.id === props.lastQuickModuleId) ?? quick[0] ?? null;
  const addable = props.modules.filter(
    (module) => module.enabled && !quick.some((item) => item.id === module.id),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Enter stays a plain click (module selection); Space starts a keyboard
    // drag that snaps to sibling tabs via the sortable coordinate getter.
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function onDragEnd(event: DragEndEvent): void {
    setDragging(false);
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    // The kernel reorders the full (unfiltered) quick list, so the target
    // index must be resolved against props.quickModuleIds, not the enabled
    // subset rendered here.
    const to = props.quickModuleIds.indexOf(String(over.id));
    if (to < 0) {
      return;
    }
    props.onReorder(String(active.id), to);
  }

  // ARIA tabs pattern: ArrowLeft/ArrowRight move between tabs (and activate
  // them), wrapping at both ends. Space/Escape stay with dnd-kit's keyboard
  // drag, so the strip stays quiet while a drag is in progress.
  function onStripKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (dragging || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) {
      return;
    }
    const current = quick.findIndex((module) => module.id === selected?.id);
    if (current < 0) {
      return;
    }
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = quick[(current + step + quick.length) % quick.length];
    if (!next) {
      return;
    }
    event.preventDefault();
    props.onSelect(next.id);
    document.getElementById(`popup-tab-${next.id}`)?.focus();
  }

  return (
    <main className={styles.root}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <IconZap size={13} />
          </div>
          <div className={styles.brandInfo}>
            <span className={styles.brandName}>{t('app.name')}</span>
            <h1 className={styles.headerTitle}>{t('popup.title')}</h1>
          </div>
        </div>
        <nav className={styles.links}>
          <a
            href={props.workbenchHref}
            target="_blank"
            rel="noreferrer"
            className={styles.headerLink}
            title={t('app.openWorkbench')}
            aria-label={t('app.openWorkbench')}
          >
            <IconWorkbench size={13} />
            <span className={styles.linkText}>{t('app.openWorkbench')}</span>
          </a>
          <a
            href={props.optionsHref}
            target="_blank"
            rel="noreferrer"
            className={styles.headerLink}
            title={t('app.openSettings')}
            aria-label={t('app.openSettings')}
          >
            <IconSettings size={13} />
            <span className={styles.linkText}>{t('app.openSettings')}</span>
          </a>
        </nav>
      </header>

      {/* Quick module tabs */}
      <div className={styles.tabContainer}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          onDragStart={() => setDragging(true)}
          onDragCancel={() => setDragging(false)}
          autoScroll={false}
          modifiers={[lockToHorizontalAxis]}
        >
          <SortableContext items={quick.map((module) => module.id)} strategy={horizontalListSortingStrategy}>
            {/* Overflow must not clip the dragged tab mid-gesture; dnd-kit
                measures droppable rects, not what the user can see. */}
            <div
              className={styles.strip}
              role="tablist"
              aria-label={t('popup.title')}
              // The tabs inside own the tab order (roving tabindex); the
              // container itself stays out of it but is focusable so the
              // arrow-key handler has an addressable owner.
              tabIndex={-1}
              onKeyDown={onStripKeyDown}
              style={{ overflowX: dragging ? 'visible' : 'auto' }}
            >

              {quick.map((module) => (
                <SortableTab
                  key={module.id}
                  module={module}
                  selected={selected?.id === module.id}
                  onSelect={props.onSelect}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {quick.length === 0 ? (
        <div className={styles.emptyCard}>
          <IconBox size={24} className={styles.emptyIcon} />
          <p className={styles.emptyText}>{t('popup.empty')}</p>
        </div>
      ) : null}

      {/* Module controls toolbar */}
      <div className={styles.controls}>
        <div className={styles.addSelectWrapper}>
          <label className={styles.selectLabel}>
            <span className={styles.selectLabelText}>{t('popup.addModule')}</span>
            <div className={styles.selectControl}>
              <IconPlus size={13} className={styles.selectIcon} />
              <select
                className={styles.addSelect}
                aria-label={t('popup.addModule')}
                value=""
                onChange={(event) => {
                  if (event.target.value) {
                    props.onAdd(event.target.value);
                  }
                }}
              >
                <option value="">{t('popup.addModule')}</option>
                {addable.map((module) => (
                  <option key={module.id} value={module.id}>
                    {module.name}
                  </option>
                ))}
              </select>
            </div>
          </label>
        </div>

        {selected ? (
          <div className={styles.actionButtons}>
            <Button
              size="sm"
              variant="ghost"
              icon={<IconArrowLeft size={13} />}
              onClick={() => props.onMove(selected.id, 'left')}
              title={t('popup.moveLeft')}
              aria-label={t('popup.moveLeft')}
            >
              {t('popup.moveLeft')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<IconArrowRight size={13} />}
              onClick={() => props.onMove(selected.id, 'right')}
              title={t('popup.moveRight')}
              aria-label={t('popup.moveRight')}
            >
              {t('popup.moveRight')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<IconTrash size={13} />}
              onClick={() => props.onRemove(selected.id)}
              title={t('popup.removeModule')}
              aria-label={t('popup.removeModule')}
            >
              {t('popup.removeModule')}
            </Button>
          </div>
        ) : null}
      </div>

      {/* Active Module Surface */}
      {selected ? (
        <div
          id={`popup-tabpanel-${selected.id}`}
          role="tabpanel"
          aria-labelledby={`popup-tab-${selected.id}`}
          className={styles.surfaceCard}
        >
          <ModuleSurface
            moduleId={selected.id}
            Surface={selected.Surface ?? null}
            {...(selected.loadFailed ? { loadFailed: true } : {})}
          />
        </div>
      ) : null}
    </main>
  );
}

function SortableTab(props: {
  module: PopupModule;
  selected: boolean;
  onSelect: (id: string) => void;
}): ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: props.module.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <button
      ref={setNodeRef}
      type="button"
      id={`popup-tab-${props.module.id}`}
      aria-controls={props.selected ? `popup-tabpanel-${props.module.id}` : undefined}
      style={style}
      className={[styles.tab, props.selected ? styles.tabSelected : ''].filter(Boolean).join(' ')}
      onClick={() => props.onSelect(props.module.id)}
      {...attributes}
      {...listeners}
      role="tab"
      // These win over dnd-kit's attributes spread above: the strip is a
      // tablist, and only the selected tab may be in the tab order.
      {...(props.selected ? { 'aria-controls': `popup-tabpanel-${props.module.id}` } : {})}
      tabIndex={props.selected ? 0 : -1}
      aria-selected={props.selected}
    >
      <span className={styles.tabGrip}>
        <IconGripVertical size={12} />
      </span>
      <span className={styles.tabIcon}>
        <ModuleBadge id={props.module.id} size={13} />
      </span>
      <span className={styles.tabName}>{props.module.name}</span>
    </button>
  );
}
