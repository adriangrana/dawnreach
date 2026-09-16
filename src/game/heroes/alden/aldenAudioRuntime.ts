import type { AbilityKey } from '../types';
import { getGameSettingsSnapshot } from '../../settings/gameSettings';
import {
  subscribeWorldAttackEvents,
  subscribeWorldHeroProgressionEvents,
  type WorldAttackEvent,
  type WorldHeroProgressionEvent,
} from '../../entities/worldCombatBridge';
import {
  MATCH_PAUSE_STATE_EVENT,
  isMatchPaused,
  type MatchPauseStateDetail,
} from '../../match/matchPauseRuntime';
import { ALDEN } from './gameplay';

const ALDEN_WORLD_ENTITY_ID = 'blue-hero-alden';
const ABILITY_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];
const MIN_GAIN = 0.0001;

// Keep the source assets under src/game/sounds so Vite fingerprints/bundles them when present.
// import.meta.glob intentionally tolerates a local working tree where the authored sounds have
// not been pushed yet: the synthetic attack fallback remains available until the mp3 is present.
const SOUND_ASSETS = import.meta.glob<string>('../../sounds/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
});
const BASIC_ATTACK_SAMPLE_URL = SOUND_ASSETS['../../sounds/basic_attack.mp3'];
const GOLD_SAMPLE_URL = SOUND_ASSETS['../../sounds/gold.mp3'];

type NoiseFilterType = 'bandpass' | 'highpass' | 'lowpass';

type NoiseOptions = Readonly<{
  when: number;
  duration: number;
  gain: number;
  frequency: number;
  q?: number;
  filterType?: NoiseFilterType;
}>;

type ToneOptions = Readonly<{
  when: number;
  duration: number;
  gain: number;
  startHz: number;
  endHz: number;
  type?: OscillatorType;
}>;

let audioContext: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;
const activeSamples = new Set<HTMLAudioElement>();

function percentageSetting(key: string, fallback: number) {
  const value = Number(getGameSettingsSnapshot()[key]);
  if (!Number.isFinite(value)) return fallback / 100;
  return Math.min(1, Math.max(0, value / 100));
}

function combatVolume() {
  return percentageSetting('audio.master', 85) * percentageSetting('audio.effects', 80);
}

function ensureAudioContext() {
  if (audioContext) return audioContext;
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null;
  audioContext = new window.AudioContext();
  return audioContext;
}

function ensureNoiseBuffer(context: AudioContext) {
  if (noiseBuffer && noiseBuffer.sampleRate === context.sampleRate) return noiseBuffer;
  const frameCount = Math.ceil(context.sampleRate * 0.7);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) channel[index] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

function scheduleTone(context: AudioContext, options: ToneOptions) {
  const volume = combatVolume();
  if (volume <= 0) return;

  const when = Math.max(context.currentTime + 0.002, options.when);
  const duration = Math.max(0.025, options.duration);
  const end = when + duration;
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = options.type ?? 'sine';
  oscillator.frequency.setValueAtTime(Math.max(35, options.startHz), when);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, options.endHz), end);

  const peak = Math.max(MIN_GAIN, options.gain * volume);
  const attackEnd = when + Math.min(0.012, duration * 0.22);
  gainNode.gain.setValueAtTime(MIN_GAIN, when);
  gainNode.gain.exponentialRampToValueAtTime(peak, attackEnd);
  gainNode.gain.exponentialRampToValueAtTime(MIN_GAIN, end);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(when);
  oscillator.stop(end + 0.02);

  window.setTimeout(() => {
    oscillator.disconnect();
    gainNode.disconnect();
  }, Math.max(0, Math.ceil((end - context.currentTime + 0.08) * 1000)));
}

function scheduleNoise(context: AudioContext, options: NoiseOptions) {
  const volume = combatVolume();
  if (volume <= 0) return;

  const when = Math.max(context.currentTime + 0.002, options.when);
  const duration = Math.max(0.025, options.duration);
  const end = when + duration;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gainNode = context.createGain();

  source.buffer = ensureNoiseBuffer(context);
  filter.type = options.filterType ?? 'bandpass';
  filter.frequency.setValueAtTime(Math.max(40, options.frequency), when);
  filter.Q.setValueAtTime(Math.max(0.05, options.q ?? 0.8), when);

  const peak = Math.max(MIN_GAIN, options.gain * volume);
  gainNode.gain.setValueAtTime(MIN_GAIN, when);
  gainNode.gain.exponentialRampToValueAtTime(peak, when + Math.min(0.01, duration * 0.18));
  gainNode.gain.exponentialRampToValueAtTime(MIN_GAIN, end);

  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(context.destination);
  source.start(when);
  source.stop(end + 0.02);

  window.setTimeout(() => {
    source.disconnect();
    filter.disconnect();
    gainNode.disconnect();
  }, Math.max(0, Math.ceil((end - context.currentTime + 0.08) * 1000)));
}

function scheduleBladeImpact(context: AudioContext, when: number, strength = 1) {
  scheduleNoise(context, {
    when,
    duration: 0.09,
    gain: 0.11 * strength,
    frequency: 1750,
    q: 0.75,
    filterType: 'bandpass',
  });
  scheduleTone(context, {
    when,
    duration: 0.105,
    gain: 0.09 * strength,
    startHz: 185,
    endHz: 105,
    type: 'triangle',
  });
  scheduleTone(context, {
    when: when + 0.006,
    duration: 0.075,
    gain: 0.034 * strength,
    startHz: 1180,
    endHz: 690,
    type: 'square',
  });
}

function playSyntheticBasicAttack(context: AudioContext) {
  const now = context.currentTime + 0.004;
  scheduleBladeImpact(context, now, 0.92);
  scheduleNoise(context, {
    when: now - 0.002,
    duration: 0.075,
    gain: 0.065,
    frequency: 2450,
    q: 0.45,
    filterType: 'highpass',
  });
}

function playQ(context: AudioContext) {
  const now = context.currentTime + 0.004;
  scheduleNoise(context, {
    when: now,
    duration: 0.18,
    gain: 0.12,
    frequency: 1320,
    q: 0.65,
    filterType: 'bandpass',
  });
  scheduleTone(context, {
    when: now,
    duration: 0.17,
    gain: 0.075,
    startHz: 390,
    endHz: 155,
    type: 'sawtooth',
  });
  scheduleBladeImpact(context, now + ALDEN.q.castTimeSeconds, 1.08);
}

function playW(context: AudioContext) {
  const now = context.currentTime + 0.004;
  scheduleBladeImpact(context, now, 0.58);
  scheduleTone(context, {
    when: now,
    duration: 0.30,
    gain: 0.068,
    startHz: 960,
    endHz: 610,
    type: 'sine',
  });
  scheduleTone(context, {
    when: now,
    duration: 0.22,
    gain: 0.085,
    startHz: 235,
    endHz: 165,
    type: 'triangle',
  });
  scheduleNoise(context, {
    when: now,
    duration: 0.11,
    gain: 0.052,
    frequency: 1050,
    q: 1.2,
    filterType: 'bandpass',
  });
}

function playE(context: AudioContext) {
  const now = context.currentTime + 0.004;
  scheduleNoise(context, {
    when: now,
    duration: 0.21,
    gain: 0.105,
    frequency: 910,
    q: 0.55,
    filterType: 'bandpass',
  });
  scheduleTone(context, {
    when: now,
    duration: 0.25,
    gain: 0.065,
    startHz: 300,
    endHz: 650,
    type: 'sawtooth',
  });
  scheduleTone(context, {
    when: now + 0.035,
    duration: 0.28,
    gain: 0.052,
    startHz: 820,
    endHz: 520,
    type: 'sine',
  });
  scheduleBladeImpact(context, now + 0.055, 0.72);
}

function playR(context: AudioContext) {
  const now = context.currentTime + 0.004;
  const impact = now + ALDEN.r.castTimeSeconds;

  scheduleTone(context, {
    when: now,
    duration: Math.max(0.18, ALDEN.r.castTimeSeconds),
    gain: 0.095,
    startHz: 92,
    endHz: 58,
    type: 'sine',
  });
  scheduleTone(context, {
    when: now,
    duration: Math.max(0.18, ALDEN.r.castTimeSeconds),
    gain: 0.048,
    startHz: 205,
    endHz: 570,
    type: 'sawtooth',
  });
  scheduleNoise(context, {
    when: now,
    duration: Math.max(0.16, ALDEN.r.castTimeSeconds * 0.85),
    gain: 0.055,
    frequency: 390,
    q: 0.5,
    filterType: 'lowpass',
  });
  scheduleNoise(context, {
    when: impact,
    duration: 0.26,
    gain: 0.17,
    frequency: 610,
    q: 0.58,
    filterType: 'lowpass',
  });
  scheduleTone(context, {
    when: impact,
    duration: 0.34,
    gain: 0.16,
    startHz: 118,
    endHz: 48,
    type: 'sine',
  });
  scheduleBladeImpact(context, impact + 0.006, 1.32);
  scheduleTone(context, {
    when: impact + 0.012,
    duration: 0.42,
    gain: 0.055,
    startHz: 1120,
    endHz: 720,
    type: 'sine',
  });
}

function playAbility(context: AudioContext, key: AbilityKey) {
  switch (key) {
    case 'Q': playQ(context); break;
    case 'W': playW(context); break;
    case 'E': playE(context); break;
    case 'R': playR(context); break;
  }
}

function withRunningContext(play: (context: AudioContext) => void) {
  if (combatVolume() <= 0 || isMatchPaused()) return;
  const context = ensureAudioContext();
  if (!context) return;
  if (context.state === 'running') {
    play(context);
    return;
  }
  void context.resume().then(() => play(context)).catch(() => undefined);
}

function playAuthoredSample(
  url: string | undefined,
  gain = 1,
  onFailure?: () => void,
) {
  if (!url || combatVolume() <= 0 || isMatchPaused()) return false;

  const sample = new Audio(url);
  sample.preload = 'auto';
  sample.volume = Math.min(1, Math.max(0, combatVolume() * gain));
  activeSamples.add(sample);

  const cleanup = () => {
    activeSamples.delete(sample);
    sample.removeEventListener('ended', cleanup);
    sample.removeEventListener('error', handleError);
  };
  const handleError = () => {
    cleanup();
    onFailure?.();
  };

  sample.addEventListener('ended', cleanup, { once: true });
  sample.addEventListener('error', handleError, { once: true });
  void sample.play().catch(() => {
    cleanup();
    onFailure?.();
  });
  return true;
}

function playBasicAttackSample() {
  const fallback = () => withRunningContext(playSyntheticBasicAttack);
  if (!playAuthoredSample(BASIC_ATTACK_SAMPLE_URL, 0.92, fallback)) fallback();
}

function playGoldSample() {
  playAuthoredSample(GOLD_SAMPLE_URL, 0.9);
}

function stopActiveSamples() {
  for (const sample of activeSamples) {
    sample.pause();
    sample.currentTime = 0;
  }
  activeSamples.clear();
}

/**
 * Alden's combat audio listens to authoritative gameplay signals:
 * - basic_attack.mp3 fires from the real world attack impact event;
 * - gold.mp3 fires only when the local hero receives a positive kill/objective reward event;
 * - Q/W/E/R still use their distinct generated ability layers on successful casts.
 */
export function mountAldenAudioRuntime() {
  const cooldownWasActive = new Map<AbilityKey, boolean>();

  const captureCooldowns = () => {
    for (const key of ABILITY_KEYS) {
      const button = document.querySelector<HTMLButtonElement>(
        `.ability-control[data-ability="${key}"] .ability-slot`,
      );
      cooldownWasActive.set(key, Number(button?.dataset.cooldown ?? 0) > 1);
    }
  };
  captureCooldowns();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const button = mutation.target;
      if (!(button instanceof HTMLButtonElement) || !button.classList.contains('ability-slot')) continue;
      const control = button.closest<HTMLElement>('.ability-control');
      const key = control?.dataset.ability as AbilityKey | undefined;
      if (!key || !ABILITY_KEYS.includes(key)) continue;

      const cooling = Number(button.dataset.cooldown ?? 0) > 1;
      const wasCooling = cooldownWasActive.get(key) ?? false;
      cooldownWasActive.set(key, cooling);
      if (wasCooling || !cooling) continue;
      withRunningContext(context => playAbility(context, key));
    }
  });
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-cooldown'],
  });

  const disposeAttackSubscription = subscribeWorldAttackEvents((event: WorldAttackEvent) => {
    if (event.attackerId !== ALDEN_WORLD_ENTITY_ID || event.attackerKind !== 'hero') return;
    playBasicAttackSample();
  });

  const disposeProgressionSubscription = subscribeWorldHeroProgressionEvents(
    (event: WorldHeroProgressionEvent) => {
      if (event.heroEntityId !== ALDEN_WORLD_ENTITY_ID || event.goldDelta <= 0) return;
      playGoldSample();
    },
  );

  const onPauseState = (event: Event) => {
    const detail = (event as CustomEvent<MatchPauseStateDetail>).detail;
    const context = audioContext;
    if (!detail) return;

    if (detail.paused) {
      stopActiveSamples();
      if (context && context.state === 'running') void context.suspend().catch(() => undefined);
    } else if (context?.state === 'suspended') {
      void context.resume().catch(() => undefined);
    }
  };
  window.addEventListener(MATCH_PAUSE_STATE_EVENT, onPauseState as EventListener);

  return () => {
    observer.disconnect();
    disposeAttackSubscription();
    disposeProgressionSubscription();
    window.removeEventListener(MATCH_PAUSE_STATE_EVENT, onPauseState as EventListener);
    stopActiveSamples();
    const context = audioContext;
    audioContext = null;
    noiseBuffer = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  };
}
