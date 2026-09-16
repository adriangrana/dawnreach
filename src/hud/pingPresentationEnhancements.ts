import { getGameSettingsSnapshot } from '../game/settings/gameSettings';
import { DAWNREACH_PING_EVENT, type DawnreachPingDetail, type PingType } from './pingWheel';

const ATTACK_SWORD_SVG = `
  <svg class="dawnreach-ping-sword-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M14.4 3.4 21 2l-1.4 6.6-8.15 8.15-4.2-4.2L15.4 4.4" />
    <path d="m7.2 12.6-2.3 2.3 4.2 4.2 2.3-2.3" />
    <path d="m7.15 17.15-3.9 3.9" />
    <path d="m2.6 21.4 2.65-.65" />
  </svg>`;

type ToneProfile = Readonly<{
  startHz: number;
  endHz: number;
  overtoneRatio: number;
  durationSeconds: number;
}>;

type EnrichedPingDetail = DawnreachPingDetail & {
  senderHeroName?: string;
  senderDisplayName?: string;
};

const TONE_PROFILES: Record<PingType, ToneProfile> = {
  attention: { startHz: 720, endHz: 980, overtoneRatio: 1.52, durationSeconds: 0.17 },
  danger: { startHz: 540, endHz: 390, overtoneRatio: 1.43, durationSeconds: 0.21 },
  assist: { startHz: 660, endHz: 860, overtoneRatio: 1.50, durationSeconds: 0.19 },
  'on-my-way': { startHz: 700, endHz: 1040, overtoneRatio: 1.56, durationSeconds: 0.16 },
  retreat: { startHz: 610, endHz: 455, overtoneRatio: 1.45, durationSeconds: 0.21 },
  missing: { startHz: 650, endHz: 760, overtoneRatio: 1.48, durationSeconds: 0.20 },
  attack: { startHz: 760, endHz: 1080, overtoneRatio: 1.60, durationSeconds: 0.17 },
};

let audioContext: AudioContext | null = null;

function isPingDetail(value: unknown): value is DawnreachPingDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Partial<DawnreachPingDetail>;
  return typeof detail.type === 'string' && typeof detail.pingId === 'string';
}

function replaceAttackIcons(root: ParentNode = document) {
  const icons = root.querySelectorAll<HTMLElement>(
    '[data-ping-type="attack"] > i, .dawnreach-ping-marker--attack > i',
  );
  icons.forEach((icon) => {
    if (icon.dataset.dawnreachSwordIcon === 'true') return;
    icon.dataset.dawnreachSwordIcon = 'true';
    icon.innerHTML = ATTACK_SWORD_SVG;
  });
}

function getLocalHeroName() {
  const hero = document.querySelector<HTMLElement>('.game-hud .hero-identity > strong');
  return hero?.textContent?.trim() || null;
}

function getLocalPlayerName() {
  const player = document.querySelector<HTMLElement>(
    '.match-scoreboard-player.is-local .match-scoreboard-identity strong',
  );
  return player?.textContent?.trim() || null;
}

function readablePlayerId(playerId: string) {
  if (!playerId || playerId === 'local-player') return null;
  return playerId
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase())
    .trim() || null;
}

function resolveSenderIdentity(detail: DawnreachPingDetail) {
  const enriched = detail as EnrichedPingDetail;

  if (!enriched.senderHeroName && detail.playerId === 'local-player') {
    const heroName = getLocalHeroName();
    if (heroName) enriched.senderHeroName = heroName;
  }
  if (!enriched.senderDisplayName && detail.playerId === 'local-player') {
    const playerName = getLocalPlayerName();
    if (playerName) enriched.senderDisplayName = playerName;
  }

  const heroName = enriched.senderHeroName?.trim() || null;
  const displayName = enriched.senderDisplayName?.trim() || readablePlayerId(detail.playerId);
  return {
    heroName,
    displayName,
    label: heroName || displayName || 'ALIADO',
  };
}

function decorateOnMyWayPing(detail: DawnreachPingDetail) {
  if (detail.type !== 'on-my-way') return;
  const identity = resolveSenderIdentity(detail);

  document.querySelectorAll<HTMLElement>('.dawnreach-ping-marker--on-my-way').forEach((marker) => {
    if (marker.dataset.pingId !== detail.pingId) return;
    marker.dataset.sender = identity.label;
    marker.setAttribute('aria-label', `${identity.label} está en camino`);
    marker.title = `${identity.label} está en camino`;

    const text = marker.querySelector<HTMLElement>(':scope > span');
    if (text && !marker.classList.contains('is-minimap')) {
      text.replaceChildren();
      const sender = document.createElement('small');
      sender.className = 'dawnreach-ping-sender-name';
      sender.textContent = identity.label.toLocaleUpperCase();
      const status = document.createElement('b');
      status.textContent = 'EN CAMINO';
      text.append(sender, status);
    }

    if (marker.classList.contains('is-minimap')) {
      let badge = marker.querySelector<HTMLElement>('.dawnreach-ping-sender-badge');
      if (!badge) {
        badge = document.createElement('em');
        badge.className = 'dawnreach-ping-sender-badge';
        marker.appendChild(badge);
      }
      badge.textContent = identity.label.slice(0, 1).toLocaleUpperCase();
      badge.setAttribute('aria-hidden', 'true');
    }
  });
}

function getPingVolume() {
  const raw = Number(getGameSettingsSnapshot()['audio.pings']);
  const percent = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 90;
  return percent / 100;
}

function ensureAudioContext() {
  if (audioContext) return audioContext;
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null;
  audioContext = new window.AudioContext();
  return audioContext;
}

function schedulePingTone(context: AudioContext, type: PingType) {
  const volume = getPingVolume();
  if (volume <= 0) return;

  const profile = TONE_PROFILES[type] ?? TONE_PROFILES.attention;
  const now = context.currentTime + 0.004;
  const end = now + profile.durationSeconds;
  const output = context.createGain();
  const primary = context.createOscillator();
  const overtone = context.createOscillator();
  const overtoneGain = context.createGain();

  primary.type = 'sine';
  primary.frequency.setValueAtTime(profile.startHz, now);
  primary.frequency.exponentialRampToValueAtTime(Math.max(40, profile.endHz), end);

  overtone.type = 'triangle';
  overtone.frequency.setValueAtTime(profile.startHz * profile.overtoneRatio, now);
  overtone.frequency.exponentialRampToValueAtTime(
    Math.max(40, profile.endHz * profile.overtoneRatio),
    end,
  );

  const peak = Math.max(0.0001, 0.11 * volume);
  output.gain.setValueAtTime(0.0001, now);
  output.gain.exponentialRampToValueAtTime(peak, now + 0.012);
  output.gain.exponentialRampToValueAtTime(0.0001, end);
  overtoneGain.gain.setValueAtTime(0.16, now);
  overtoneGain.gain.exponentialRampToValueAtTime(0.035, end);

  primary.connect(output);
  overtone.connect(overtoneGain);
  overtoneGain.connect(output);
  output.connect(context.destination);

  primary.start(now);
  overtone.start(now);
  primary.stop(end + 0.02);
  overtone.stop(end + 0.02);

  window.setTimeout(() => {
    primary.disconnect();
    overtone.disconnect();
    overtoneGain.disconnect();
    output.disconnect();
  }, Math.ceil((profile.durationSeconds + 0.08) * 1000));
}

function playPingSound(type: PingType) {
  const context = ensureAudioContext();
  if (!context || getPingVolume() <= 0) return;
  if (context.state === 'running') {
    schedulePingTone(context, type);
    return;
  }
  void context.resume().then(() => schedulePingTone(context, type)).catch(() => undefined);
}

/**
 * Presentation additions that intentionally stay transport-agnostic: every local or replicated
 * DAWNREACH_PING_EVENT gets the same sword icon treatment, sender identity and audible cue.
 * Local sender identity is added to the event object before pingWheel posts it to the shared
 * BroadcastChannel, so other Dawnreach clients receive the same hero/player label.
 */
export function mountPingPresentationEnhancements() {
  replaceAttackIcons();

  const mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches('[data-ping-type="attack"] > i, .dawnreach-ping-marker--attack > i')) {
          replaceAttackIcons(node.parentElement ?? node);
        } else {
          replaceAttackIcons(node);
        }
      });
    }
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });

  const onPing = (event: Event) => {
    const detail = (event as CustomEvent<DawnreachPingDetail>).detail;
    if (!isPingDetail(detail)) return;

    // Enrich local payloads before pingWheel returns from dispatchEvent and posts the same
    // object to BroadcastChannel. Remote payloads already retain these fields.
    resolveSenderIdentity(detail);
    replaceAttackIcons();
    decorateOnMyWayPing(detail);
    playPingSound(detail.type);
  };
  window.addEventListener(DAWNREACH_PING_EVENT, onPing as EventListener);

  return () => {
    mutationObserver.disconnect();
    window.removeEventListener(DAWNREACH_PING_EVENT, onPing as EventListener);
    const context = audioContext;
    audioContext = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  };
}
