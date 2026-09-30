import { canRoleSpeakTab, ChatTabPermission } from '@axe/domain/chat/chat-tab-permission';
import { PeerRole } from '@axe/domain/peer/peer-role';
import { SwitchDefinition, switchDoesAnything } from '@axe/domain/tabletop/board-switch/switch-definition';

/**
 * Why a press came to nothing.
 *
 * `nothing` is a switch with nothing written in it; `watching` is somebody watching the table
 * pressing a switch not left open to watchers; `cannotSpeak` is a switch that would speak into a
 * tab the presser may not speak in; `retired` is a switch taken off the table for good.
 */
export type SwitchRefusal = 'nothing' | 'watching' | 'cannotSpeak' | 'retired';

export interface SwitchPressState {
  definition: SwitchDefinition;
  role: PeerRole;
  /** The tab the switch would speak into, or null where the room has none. */
  tab: ChatTabPermission | null;
  retired: boolean;
}

/**
 * Whether this press is turned away, and why, or null where the switch may go ahead.
 *
 * The chat's own sending does not ask whether somebody may speak in a tab, since the chat window
 * asks before it sends. A switch speaks without the chat window, so it asks here instead, and a
 * switch that says anything at all is held to the tab it says it into.
 */
export function pressRefusal(state: SwitchPressState): SwitchRefusal | null {
  if (state.retired) return 'retired';
  if (!switchDoesAnything(state.definition)) return 'nothing';
  if (state.role === PeerRole.Guest && !state.definition.guests) return 'watching';
  const speaks = state.definition.actions.some((action) => action.kind === 'say' && action.text.trim().length > 0);
  if (speaks && (!state.tab || !canRoleSpeakTab(state.tab, state.role))) return 'cannotSpeak';
  return null;
}
