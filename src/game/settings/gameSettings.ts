export type GameSettingValue = boolean | number | string;
export type GameSettings = Record<string, GameSettingValue>;

export const GAME_SETTINGS_STORAGE_KEY = 'dawnreach:game-settings:v1';
export const GAME_SETTINGS_CHANGED_EVENT = 'dawnreach:game-settings-changed';

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  // Gameplay
  'gameplay.autoAttack': 'standard',
  'gameplay.quickCast': 'press',
  'gameplay.attackMoveTarget': 'cursor',
  'gameplay.stickyTarget': true,
  'gameplay.smartSelfCast': true,
  'gameplay.doubleTapSelfCast': false,
  'gameplay.showCastRange': true,
  'gameplay.showAttackRange': true,
  'gameplay.moveCommandIndicator': true,
  'gameplay.autoSelectSummons': false,
  'gameplay.autoOpenShop': true,
  'gameplay.damageNumbers': true,
  'gameplay.damageTextStacking': true,
  'gameplay.screenShake': 55,
  'gameplay.cursorConfine': true,
  'gameplay.rightClickDeny': false,
  'gameplay.holdPositionCancelsAttack': true,

  // Camera
  'camera.edgePan': true,
  'camera.keyboardPan': true,
  'camera.edgeSize': 14,
  'camera.panSpeed': 18,
  'camera.zoomSpeed': 55,
  'camera.minZoom': 70,
  'camera.maxZoom': 125,
  'camera.smoothing': 35,
  'camera.recenterSpeed': 70,
  'camera.followHero': 'off',
  'camera.dragInvert': false,
  'camera.minimapDrag': true,
  'camera.minimapClick': true,
  'camera.shakeIntensity': 55,

  // Graphics
  'graphics.displayMode': 'borderless',
  'graphics.resolution': 'native',
  'graphics.renderScale': 100,
  'graphics.vsync': true,
  'graphics.frameLimit': '120',
  'graphics.preset': 'high',
  'graphics.textureQuality': 'high',
  'graphics.shadowQuality': 'high',
  'graphics.shadowDistance': 75,
  'graphics.effectsQuality': 'high',
  'graphics.particleQuality': 'high',
  'graphics.terrainQuality': 'high',
  'graphics.vegetationQuality': 'medium',
  'graphics.antiAliasing': 'taa',
  'graphics.anisotropicFiltering': '8x',
  'graphics.ambientOcclusion': true,
  'graphics.bloom': true,
  'graphics.dynamicLights': true,
  'graphics.reflections': true,
  'graphics.weatherEffects': true,
  'graphics.postProcessing': true,
  'graphics.motionBlur': false,
  'graphics.chromaticAberration': false,
  'graphics.colorGrading': 'cinematic',
  'graphics.lowLatency': true,

  // Audio
  'audio.master': 85,
  'audio.music': 55,
  'audio.effects': 80,
  'audio.interface': 70,
  'audio.ambience': 65,
  'audio.voice': 80,
  'audio.announcer': 85,
  'audio.pings': 90,
  'audio.output': 'default',
  'audio.spatial': true,
  'audio.heroVoices': true,
  'audio.unitResponses': true,
  'audio.combatAlerts': true,
  'audio.dynamicMusic': true,
  'audio.muteUnfocused': false,
  'audio.dynamicRange': 'wide',

  // Interface
  'interface.uiScale': 100,
  'interface.textScale': 100,
  'interface.hudOpacity': 100,
  'interface.minimapScale': 100,
  'interface.minimapSide': 'left',
  'interface.minimapIconScale': 110,
  'interface.showHeroNames': true,
  'interface.showHealthBars': true,
  'interface.showManaBars': true,
  'interface.showStatusEffects': true,
  'interface.showCooldownNumbers': true,
  'interface.showObjectiveTimers': true,
  'interface.showDamagePreview': true,
  'interface.showFps': true,
  'interface.showNetworkStats': false,
  'interface.combatLog': false,
  'interface.chatTimestamps': true,
  'interface.tooltipDelay': 250,
  'interface.cursorScale': 100,
  'interface.shopAdvancedStats': true,
  'interface.scoreboardDetailed': true,

  // Accessibility
  'accessibility.colorBlindMode': 'none',
  'accessibility.highContrast': false,
  'accessibility.reducedMotion': false,
  'accessibility.reduceFlashes': false,
  'accessibility.subtitles': true,
  'accessibility.subtitleSize': 100,
  'accessibility.visualPings': true,
  'accessibility.edgeAlerts': true,
  'accessibility.largeCursor': false,
  'accessibility.holdToToggle': false,
  'accessibility.simplifiedEffects': false,
  'accessibility.screenReaderHints': false,

  // Network / social
  'network.region': 'auto',
  'network.interpolation': 'balanced',
  'network.maxPingWarning': 120,
  'network.showPacketLoss': false,
  'network.reconnectAutomatically': true,
  'social.profanityFilter': true,
  'social.teamChatOnly': false,
  'social.muteAllVoice': false,
  'social.allowPartyInvites': true,
  'social.allowFriendRequests': true,
  'social.streamerMode': false,
  'privacy.crashReports': true,
  'privacy.performanceTelemetry': true,

  // Controls / keybinds
  'controls.abilityQ': 'KeyQ',
  'controls.abilityW': 'KeyW',
  'controls.abilityE': 'KeyE',
  'controls.abilityR': 'KeyR',
  'controls.attackMove': 'KeyA',
  'controls.stop': 'KeyS',
  'controls.holdPosition': 'KeyH',
  'controls.selectHero': 'F1',
  'controls.centerHero': 'Space',
  'controls.scoreboard': 'Tab',
  'controls.shop': 'F4',
  'controls.pingWheel': 'KeyG',
  'controls.dangerPing': 'KeyV',
  'controls.teleport': 'KeyT',
  'controls.item1': 'Alt+KeyQ',
  'controls.item2': 'Alt+KeyW',
  'controls.item3': 'Alt+KeyE',
  'controls.item4': 'Alt+KeyA',
  'controls.item5': 'Alt+KeyS',
  'controls.item6': 'Alt+KeyD',
  'controls.cameraLeft': 'ArrowLeft',
  'controls.cameraRight': 'ArrowRight',
  'controls.cameraUp': 'ArrowUp',
  'controls.cameraDown': 'ArrowDown',
  'controls.mouseSensitivity': 50,
  'controls.doubleClickMs': 280,
  'controls.altSelfCast': true,
};

/**
 * Settings with a real runtime consumer in the current Dawnreach build.
 * Everything else remains visible in Options as a disabled roadmap entry so the UI never
 * suggests that a switch changes the game when no engine subsystem consumes it yet.
 */
export const IMPLEMENTED_GAME_SETTINGS: ReadonlySet<string> = new Set([
  'gameplay.showCastRange',
  'gameplay.cursorConfine',

  'camera.edgePan',
  'camera.keyboardPan',
  'camera.edgeSize',
  'camera.panSpeed',
  'camera.minimapDrag',
  'camera.minimapClick',

  'graphics.renderScale',
  'graphics.frameLimit',
  'graphics.shadowQuality',
  'graphics.shadowDistance',

  'interface.uiScale',
  'interface.hudOpacity',
  'interface.minimapScale',
  'interface.minimapSide',
  'interface.minimapIconScale',
  'interface.showHeroNames',
  'interface.showHealthBars',
  'interface.showManaBars',
  'interface.showStatusEffects',
  'interface.showCooldownNumbers',
  'interface.showFps',

  'accessibility.highContrast',

  'controls.abilityQ',
  'controls.abilityW',
  'controls.abilityE',
  'controls.abilityR',
  'controls.attackMove',
  'controls.selectHero',
  'controls.centerHero',
  'controls.shop',
  'controls.teleport',
  'controls.item1',
  'controls.item2',
  'controls.item3',
  'controls.item4',
  'controls.item5',
  'controls.item6',
  'controls.cameraLeft',
  'controls.cameraRight',
  'controls.cameraUp',
  'controls.cameraDown',
]);

export type GameSettingsChangedDetail = Readonly<{
  settings: GameSettings;
  changedAtMs: number;
}>;

let liveSettings: GameSettings = { ...DEFAULT_GAME_SETTINGS };

function sanitizedSettings(candidate: unknown): GameSettings {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ...DEFAULT_GAME_SETTINGS };
  }
  const source = candidate as Record<string, unknown>;
  const next: GameSettings = { ...DEFAULT_GAME_SETTINGS };
  for (const [key, fallback] of Object.entries(DEFAULT_GAME_SETTINGS)) {
    const value = source[key];
    if (typeof value === typeof fallback) next[key] = value as GameSettingValue;
  }
  return next;
}

export function isGameSettingImplemented(key: string) {
  return IMPLEMENTED_GAME_SETTINGS.has(key);
}

export function loadGameSettings(): GameSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_GAME_SETTINGS };
  try {
    const raw = window.localStorage.getItem(GAME_SETTINGS_STORAGE_KEY);
    return raw ? sanitizedSettings(JSON.parse(raw)) : { ...DEFAULT_GAME_SETTINGS };
  } catch {
    return { ...DEFAULT_GAME_SETTINGS };
  }
}

export function getGameSettingsSnapshot(): GameSettings {
  return { ...liveSettings };
}

export function saveGameSettings(settings: GameSettings) {
  const normalized = sanitizedSettings(settings);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(GAME_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Local persistence is optional; runtime application still succeeds.
    }
  }
  applyGameSettings(normalized);
  return normalized;
}

export function resetGameSettings() {
  return saveGameSettings({ ...DEFAULT_GAME_SETTINGS });
}

function finiteNumber(settings: GameSettings, key: string, fallback: number) {
  const value = Number(settings[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function applyGameSettings(settings: GameSettings) {
  const normalized = sanitizedSettings(settings);
  liveSettings = { ...normalized };
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const root = document.documentElement;
  const body = document.body;

  root.style.setProperty('--dawnreach-user-ui-scale', `${finiteNumber(normalized, 'interface.uiScale', 100) / 100}`);
  root.style.setProperty('--dawnreach-text-scale', `${finiteNumber(normalized, 'interface.textScale', 100) / 100}`);
  root.style.setProperty('--dawnreach-hud-opacity', `${finiteNumber(normalized, 'interface.hudOpacity', 100) / 100}`);
  root.style.setProperty('--dawnreach-cursor-scale', `${finiteNumber(normalized, 'interface.cursorScale', 100) / 100}`);
  root.style.setProperty('--dawnreach-minimap-scale', `${finiteNumber(normalized, 'interface.minimapScale', 100) / 100}`);
  root.style.setProperty('--dawnreach-minimap-icon-scale', `${finiteNumber(normalized, 'interface.minimapIconScale', 110) / 100}`);

  body.dataset.dawnreachMinimapSide = String(normalized['interface.minimapSide'] ?? 'left');
  body.dataset.dawnreachShowHeroNames = String(Boolean(normalized['interface.showHeroNames']));
  body.dataset.dawnreachShowHealthBars = String(Boolean(normalized['interface.showHealthBars']));
  body.dataset.dawnreachShowManaBars = String(Boolean(normalized['interface.showManaBars']));
  body.dataset.dawnreachShowStatusEffects = String(Boolean(normalized['interface.showStatusEffects']));
  body.dataset.dawnreachShowCooldownNumbers = String(Boolean(normalized['interface.showCooldownNumbers']));
  body.dataset.dawnreachShowFps = String(Boolean(normalized['interface.showFps']));
  body.dataset.dawnreachHighContrast = String(Boolean(normalized['accessibility.highContrast']));

  window.dispatchEvent(new CustomEvent<GameSettingsChangedDetail>(GAME_SETTINGS_CHANGED_EVENT, {
    detail: { settings: { ...normalized }, changedAtMs: performance.now() },
  }));
}

export function initializeGameSettings() {
  const settings = loadGameSettings();
  applyGameSettings(settings);
  return settings;
}

export function formatKeyBinding(binding: string) {
  const replacements: Record<string, string> = {
    Space: 'ESPACIO',
    Tab: 'TAB',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ShiftLeft: 'SHIFT IZQ.',
    ShiftRight: 'SHIFT DER.',
    ControlLeft: 'CTRL IZQ.',
    ControlRight: 'CTRL DER.',
    AltLeft: 'ALT IZQ.',
    AltRight: 'ALT DER.',
  };
  return binding
    .split('+')
    .map(part => replacements[part] ?? part.replace(/^Key/, '').replace(/^Digit/, ''))
    .join(' + ');
}

export function bindingFromKeyboardEvent(event: KeyboardEvent) {
  const modifiers: string[] = [];
  if (event.ctrlKey && !event.code.startsWith('Control')) modifiers.push('Ctrl');
  if (event.altKey && !event.code.startsWith('Alt')) modifiers.push('Alt');
  if (event.shiftKey && !event.code.startsWith('Shift')) modifiers.push('Shift');
  if (event.metaKey && !event.code.startsWith('Meta')) modifiers.push('Meta');
  return [...modifiers, event.code].join('+');
}

export function keyBindingMatchesEvent(event: KeyboardEvent, binding: string) {
  const parts = binding.split('+').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  const code = parts[parts.length - 1];
  const wantsCtrl = parts.includes('Ctrl');
  const wantsAlt = parts.includes('Alt');
  const wantsShift = parts.includes('Shift');
  const wantsMeta = parts.includes('Meta');
  return event.code === code
    && event.ctrlKey === wantsCtrl
    && event.altKey === wantsAlt
    && event.shiftKey === wantsShift
    && event.metaKey === wantsMeta;
}

export function settingBindingMatchesEvent(
  event: KeyboardEvent,
  settingKey: string,
  settings: GameSettings = liveSettings,
) {
  return keyBindingMatchesEvent(event, String(settings[settingKey] ?? DEFAULT_GAME_SETTINGS[settingKey] ?? ''));
}
