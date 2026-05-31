import { getBehaviorDefaultMeasurement, resolveBehaviorMeasurementForAction } from './abaBehaviorCapture';

export type AbaQuickBehaviorShortcut = {
  behaviorId: string;
  label: string;
  method: string;
  priority: number;
  visibleInDock: boolean;
  color: string;
  icon: string;
};

const defaultQuickShortcutIds = ['aggression', 'escape', 'refusal', 'self_injury', 'crying', 'stereotypy'];
const crisisShortcutIds = ['aggression', 'self_injury', 'escape', 'abc'];

const shortcutLabelById: Record<string, string> = {
  aggression: 'Agressão +1',
  self_injury: 'Autoagressão +1',
  escape: 'Fuga',
  refusal: 'Recusa +1',
  crying: 'Choro',
  stereotypy: 'Estereotipia',
  abc: 'ABC rápido'
};

const shortcutColorById: Record<string, string> = {
  aggression: 'red',
  self_injury: 'rose',
  escape: 'amber',
  refusal: 'violet',
  crying: 'sky',
  stereotypy: 'emerald',
  abc: 'slate'
};

export const normalizeQuickBehaviorShortcuts = (
  configuredShortcuts: any,
  behaviors: Array<{ id: string; name: string; defaultMeasurement?: string; allowedMeasurements?: string[] }>
): AbaQuickBehaviorShortcut[] => {
  const byId = new Map(behaviors.map((behavior) => [String(behavior.id), behavior]));
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
        behaviorId,
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
  const limit = Number(options.limit || 3);
  if (options.crisisMode) {
    const crisisOrder = new Map(crisisShortcutIds.map((id, index) => [id, index]));
    return shortcuts
      .filter((shortcut) => crisisOrder.has(shortcut.behaviorId))
      .sort((a, b) => Number(crisisOrder.get(a.behaviorId) || 0) - Number(crisisOrder.get(b.behaviorId) || 0))
      .slice(0, limit);
  }
  return shortcuts.filter((shortcut) => shortcut.visibleInDock).slice(0, limit);
};

export const shouldShowClinicalDock = (viewportWidth: number, mobileFocusMode = false, forceDock = false) => (
  forceDock || mobileFocusMode || viewportWidth <= 1024
);

export const getCrisisShortcutIds = () => [...crisisShortcutIds];
