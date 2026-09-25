import { ActionKind, MemoryAction } from './memory-actions';

// Memory Detail only: 'comingSoon' actions are placeholders (Save for Trip, Related
// Memories), and 'collection' (Save for Later) duplicates the canonical Add to Collection.
const HIDDEN_KINDS: ActionKind[] = ['comingSoon', 'collection'];

const CONTEXTUAL_PRIORITY: ActionKind[] = ['calendar', 'maps', 'openUrl', 'ask'];

export interface DetailActionSplit {
  primary: MemoryAction | null;
  secondary: MemoryAction[];
}

export function splitDetailActions(actions: MemoryAction[]): DetailActionSplit {
  const visible = actions.filter((action) => !HIDDEN_KINDS.includes(action.kind));

  let primary: MemoryAction | null = null;
  for (const kind of CONTEXTUAL_PRIORITY) {
    primary = visible.find((action) => action.kind === kind) ?? null;
    if (primary) break;
  }

  return {
    primary,
    secondary: visible.filter((action) => action !== primary),
  };
}
