import { mountAldenAudioRuntime } from './heroes/alden/aldenAudioRuntime';
import { mountAldenWorldAbilityBootstrap } from './heroes/alden/worldAbilityBootstrap';
import { warmTeleportPortalGeometry } from './items/teleportPortalWarmup';
import { installMatchEndRuntime } from './match/matchEndRuntime';
import { installMatchEventAnnouncementRuntime } from './match/matchEventAnnouncements';
import { installMatchEventLifecycleRuntime } from './match/matchEventLifecycleRuntime';
import { installMatchEventRuntime } from './match/matchEventRuntime';
import {
  applyAuthoritativeMatchPause,
  installMatchPauseRuntime,
  setMatchPauseRequestForwarder,
} from './match/matchPauseRuntime';
import { installRuntimePerformanceTuning } from './performance/runtimePerformanceTuning';
import { installShadowInvalidationBridge } from './performance/shadowInvalidationBridge';
import { mountAbilityRangeSettingsGuard } from '../hud/abilityRangeSettingsGuard';
import { mountBrowserInteractionGuards } from '../hud/browserInteractionGuards';
import { mountCombatStatsOverlay } from '../hud/combatStatsOverlay';
import { mountFpsOverlay } from '../hud/fpsOverlay';
import { mountGameCameraControls } from '../hud/gameCameraControls';
import { mountGameMenu } from '../hud/gameMenu';
import { mountGameMenuQuickKeys } from '../hud/gameMenuQuickKeys';
import { mountGameplayKeybindBridge } from '../hud/gameplayKeybindBridge';
import { mountHeroFunctionKeyControls } from '../hud/heroFunctionKeyControls';
import { mountInGameChat, type InGameChatRuntimeOptions } from '../hud/inGameChat';
import { mountInventoryControls } from '../hud/inventoryControls';
import { mountMatchEventBanner } from '../hud/matchEventBanner';
import { mountMatchEventFeed } from '../hud/matchEventFeed';
import { mountMinimapDragCamera } from '../hud/minimapDragCamera';
import { mountPingPresentationEnhancements } from '../hud/pingPresentationEnhancements';
import { mountPingWheel } from '../hud/pingWheel';
import { mountResponsiveHudScale } from '../hud/responsiveHudScale';
import { mountSelectionHudNameLayout } from '../hud/selectionHudNameLayout';
import { mountSettingsAvailability } from '../hud/settingsAvailability';
import { mountSettingsSliderValueGuard } from '../hud/settingsSliderValueGuard';
import { mountTowerPortraitAssets } from '../hud/towerPortraitAssets';
import { platformRealtime } from '../platform/realtimeClient';
import type { PlatformRealtimeEvent } from '../platform/types';

/**
 * Owns all imperative in-match runtimes. Keeping this lifecycle out of main.tsx prevents gameplay
 * hotkeys, chat, menus and world subscriptions from leaking into Login/Home or future Hero Select.
 */
export type GameClientRuntimeOptions = InGameChatRuntimeOptions;

function mountNetworkMatchPause(options: GameClientRuntimeOptions) {
  const matchId = options.matchId?.trim() || null;
  const playerId = options.playerId?.trim() || null;
  if (!matchId || !playerId) return () => undefined;

  let lastRevision = -1;

  const clearForwarder = setMatchPauseRequestForwarder(detail => (
    platformRealtime.send('match.runtime.pause', {
      matchId,
      paused: detail.paused,
    })
  ));

  const unsubscribe = platformRealtime.subscribe((event: PlatformRealtimeEvent) => {
    if (
      typeof event !== 'object'
      || event === null
      || !('type' in event)
      || event.type !== 'match.runtime.pause'
      || !('matchId' in event)
      || event.matchId !== matchId
      || !('paused' in event)
    ) return;

    const revision = 'revision' in event ? Number(event.revision || 0) : 0;
    if (revision < lastRevision) return;
    lastRevision = revision;

    applyAuthoritativeMatchPause(
      Boolean(event.paused),
      Boolean(event.paused) && 'pausedByUserId' in event && event.pausedByUserId
        ? String(event.pausedByUserId)
        : null,
      performance.now(),
    );
  });

  return () => {
    clearForwarder();
    unsubscribe();
  };
}

export function mountGameClientRuntime(options: GameClientRuntimeOptions = {}) {
  const disposers: Array<() => void> = [];
  const own = (dispose: unknown) => {
    if (typeof dispose === 'function') disposers.push(dispose as () => void);
  };

  own(installMatchEventRuntime());
  own(installMatchEventAnnouncementRuntime());
  own(installMatchEndRuntime());
  own(installMatchPauseRuntime());
  own(mountNetworkMatchPause(options));
  own(installMatchEventLifecycleRuntime());
  own(installRuntimePerformanceTuning());
  own(installShadowInvalidationBridge());
  own(mountAldenWorldAbilityBootstrap());

  own(mountMatchEventFeed());
  own(mountMatchEventBanner());
  // Chat capture listeners intentionally mount before gameplay key handlers.
  own(mountInGameChat(options));
  own(mountAldenAudioRuntime());
  own(mountGameMenuQuickKeys());
  own(mountGameMenu());
  own(mountSettingsSliderValueGuard());
  own(mountSettingsAvailability());
  own(mountAbilityRangeSettingsGuard());
  own(mountBrowserInteractionGuards());
  own(mountCombatStatsOverlay());
  own(mountFpsOverlay());
  own(mountResponsiveHudScale());
  own(mountPingWheel());
  own(mountPingPresentationEnhancements());
  own(mountHeroFunctionKeyControls());
  own(mountInventoryControls());
  own(mountGameplayKeybindBridge());
  own(mountGameCameraControls());
  own(mountMinimapDragCamera());
  own(mountTowerPortraitAssets());
  own(mountSelectionHudNameLayout());

  void warmTeleportPortalGeometry().catch(error => {
    console.warn('[Dawnreach] Teleport portal warmup failed; continuing without it.', error);
  });

  return () => {
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      try { disposers[index](); } catch (error) { console.warn('[Dawnreach] Runtime cleanup failed.', error); }
    }
  };
}
