import { getBehaviorDefaultMeasurement, resolveBehaviorMeasurementForAction } from './abaBehaviorCapture';
import { ABA_CATALOG_PRESETS } from './abaBehaviorCatalog';

export type AbaQuickBehaviorShortcut = {
  behaviorId: string;
  label: string;
  method: string;
  priority: number;
  visibleInDock: boolean;
  color: string;
  icon: string;
  presetKey?: string;
};

const defaultQuickShortcutIds = ['aggression', 'escape', 'refusal', 'self_injury', 'crying', 'stereotypy', 'screaming'];
const crisisShortcutIds = ['aggression', 'self_injury', 'escape', 'abc'];

const shortcutLabelById: Record<string, string> = {
  aggression: 'Agressão +1',
  self_injury: 'Autoagressão +1',
  escape: 'Fuga',
  refusal: 'Recusa +1',
  crying: 'Choro',
  stereotypy: 'Estereotipia',
  screaming: 'Grito',
  abc: 'ABC rápido'
};

const shortcutColorById: Record<string, string> = {
  aggression: 'red',
  self_injury: 'rose',
  escape: 'amber',
  refusal: 'violet',
  crying: 'sky',
  stereotypy: 'emerald',
  screaming: 'sky',
  abc: 'slate'
};

export const normalizeQuickBehaviorShortcuts = (
  configuredShortcuts: any,
  behaviors: Array<{ id: string; name: string; defaultMeasurement?: string; allowedMeasurements?: string[]; presetKey?: string | null }>
): AbaQuickBehaviorShortcut[] => {
  const byId = new Map(behaviors.map((behavior) => [String(behavior.id), behavior]));
  for (const behavior of behaviors) {
    const preset = ABA_CATALOG_PRESETS.find((item) =>
      behavior.presetKey === item.key ||
      behavior.name.trim().toLocaleLowerCase('pt-BR') === item.name.toLocaleLowerCase('pt-BR'));
    if (preset) {
      byId.set(preset.key, behavior);
      byId.set('default:' + preset.key, behavior);
    }
  }
  const rawShortcuts = Array.isArray(configuredShortcuts) && configuredShortcuts.length > 0
    ? configuredShortcuts
    : defaultQuickShortcutIds.map((behaviorId, index) => ({ behaviorId, priority: index + 1, visibleInDock: index < 3 }));

  return rawShortcuts
    .map((shortcut: any, index: number) => {
      const behaviorId = String(shortcut?.behaviorId || shortcut?.behavior_id || shortcut?.id || '').trim();
      const behavior = byId.get(behaviorId);
      if (!behavior) return null;
      const method = resolveBehaviorMeasurementForAction(
        behavior,
        shortcut?.method || shortcut?.measurementType || getBehaviorDefaultMeasurement(behavior)
      );
      return {
        behaviorId: behavior.id,
        presetKey: behavior.presetKey || ABA_CATALOG_PRESETS.find((item) => item.key === behaviorId)?.key || undefined,
        label: String(shortcut?.label || shortcutLabelById[behaviorId] || behavior.name),
        method,
        priority: Number(shortcut?.priority ?? index + 1),
        visibleInDock: shortcut?.visibleInDock !== false && shortcut?.visible_in_dock !== false,
        color: String(shortcut?.color || shortcutColorById[behaviorId] || 'slate'),
        icon: String(shortcut?.icon || (method === 'duration' ? 'duration' : 'plus'))
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(a?.priority || 0) - Number(b?.priority || 0)) as AbaQuickBehaviorShortcut[];
};

export const getDockVisibleShortcuts = (
  shortcuts: AbaQuickBehaviorShortcut[],
  options: { crisisMode?: boolean; limit?: number } = {}
) => {
  const limit = Math.min(200, Math.max(1, Number(options.limit || 200)));
  if (options.crisisMode) {
    const crisisOrder = new Map(crisisShortcutIds.map((id, index) => [id, index]));
    return shortcuts
      .filter((shortcut) => crisisOrder.has(shortcut.presetKey || shortcut.behaviorId))
      .sort((a, b) => Number(crisisOrder.get(a.presetKey || a.behaviorId) || 0) - Number(crisisOrder.get(b.presetKey || b.behaviorId) || 0))
      .slice(0, limit);
  }
  return shortcuts.filter((shortcut) => shortcut.visibleInDock).slice(0, limit);
};

export const shouldShowClinicalDock = (_viewportWidth: number, _mobileFocusMode = false, _forceDock = false) => true;

export const getCrisisShortcutIds = () => [...crisisShortcutIds];
