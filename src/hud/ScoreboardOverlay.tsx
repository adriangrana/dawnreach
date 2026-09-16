import { useEffect, useState } from 'react';
import { Coins, Skull, WifiOff } from 'lucide-react';
import { getItemDefinition } from '../game/items/itemDatabase';
import { getItemIconDataUrl } from '../game/items/itemVisuals';
import {
  GAME_SETTINGS_CHANGED_EVENT,
  formatKeyBinding,
  getGameSettingsSnapshot,
  settingBindingMatchesEvent,
  type GameSettings,
  type GameSettingsChangedDetail,
} from '../game/settings/gameSettings';
import {
  LOCAL_HERO_ENTITY_ID,
  type MatchHeroState,
  type MatchState,
  type TeamId,
} from '../game/match';
import { subscribeCombatHudStats, type CombatHudStats } from './combatStatsOverlay';
import { GAME_MENU_STATE_EVENT, isGameMenuOpen } from './gameMenu';

const EMPTY_COMBAT_STATS: CombatHudStats = {
  kills: 0,
  deaths: 0,
  assists: 0,
  lastHits: 0,
  denies: 0,
};

const heroPortraits = import.meta.glob<string>('../game/heroes/*/images/H*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

function isEditableTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

function formatClock(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function portraitFor(hero: MatchHeroState | null) {
  if (!hero) return undefined;
  const suffix = `/images/${hero.definitionId}.webp`;
  const path = Object.keys(heroPortraits).find(candidate => candidate.endsWith(suffix));
  return path ? heroPortraits[path] : undefined;
}

function progressionCounter(hero: MatchHeroState | null, key: string) {
  if (!hero) return 0;
  const value = Number(hero.runtime.counters[key] ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function heroCombatStats(hero: MatchHeroState | null, localStats: CombatHudStats): CombatHudStats {
  if (!hero) return EMPTY_COMBAT_STATS;
  if (hero.heroEntityId === LOCAL_HERO_ENTITY_ID) {
    return {
      ...localStats,
      lastHits: hero.lastHits,
      denies: hero.denies,
    };
  }
  return {
    kills: progressionCounter(hero, 'scoreboard.kills'),
    deaths: progressionCounter(hero, 'scoreboard.deaths'),
    assists: progressionCounter(hero, 'scoreboard.assists'),
    lastHits: hero.lastHits,
    denies: hero.denies,
  };
}

function heroNetWorth(hero: MatchHeroState | null) {
  if (!hero) return 0;
  const inventoryValue = hero.inventory.reduce((total, slot) => {
    if (!slot.item) return total;
    const definition = getItemDefinition(slot.item.definitionId);
    if (!definition) return total;
    return total + definition.cost * Math.max(1, slot.item.quantity ?? 1);
  }, 0);
  return Math.max(0, Math.floor(hero.gold + inventoryValue));
}

function formatNumber(value: number) {
  return Math.max(0, Math.floor(value)).toLocaleString('es-ES');
}

function TeamTable({
  team,
  match,
  localStats,
  nowMs,
  respawnReadyAtMs,
  detailed,
}: {
  team: TeamId;
  match: MatchState;
  localStats: CombatHudStats;
  nowMs: number;
  respawnReadyAtMs: number | null;
  detailed: boolean;
}) {
  const slots = match.slots
    .filter(slot => slot.team === team)
    .sort((left, right) => left.index - right.index);
  const rows = slots.map(slot => {
    const player = slot.playerId ? match.players[slot.playerId] ?? null : null;
    const hero = slot.heroEntityId ? match.heroes[slot.heroEntityId] ?? null : null;
    const combat = heroCombatStats(hero, localStats);
    return { slot, player, hero, combat };
  });
  const kills = rows.reduce((total, row) => total + row.combat.kills, 0);
  const netWorth = rows.reduce((total, row) => total + heroNetWorth(row.hero), 0);
  const dawn = team === 'dawn';

  return (
    <section className={`match-scoreboard-team match-scoreboard-team--${team}`}>
      <header className="match-scoreboard-team-header">
        <div>
          <span>{dawn ? 'EQUIPO DEL ALBA' : 'EQUIPO DEL OCASO'}</span>
          <strong>{dawn ? 'DAWN' : 'DUSK'}</strong>
        </div>
        <div className="match-scoreboard-team-totals">
          <span><b>{kills}</b> bajas</span>
          <span><Coins aria-hidden="true" /><b>{formatNumber(netWorth)}</b> NW</span>
        </div>
      </header>

      <div className={`match-scoreboard-grid match-scoreboard-grid--header${detailed ? '' : ' is-compact'}`} aria-hidden="true">
        <span>JUGADOR / HÉROE</span><span>NV.</span><span>K / D / A</span>
        {detailed && <><span>LH / DN</span><span>ORO</span><span>NW</span></>}
        <span>OBJETOS</span>
      </div>

      <div className="match-scoreboard-rows">
        {rows.map(({ slot, player, hero, combat }) => {
          const local = hero?.heroEntityId === LOCAL_HERO_ENTITY_ID;
          const dead = Boolean(hero && hero.currentHp <= 0);
          const respawnSeconds = local && dead && respawnReadyAtMs !== null
            ? Math.max(0, Math.ceil((respawnReadyAtMs - nowMs) / 1000))
            : null;
          const portrait = portraitFor(hero);
          const mainItems = hero?.inventory
            .filter(candidate => candidate.slot >= 0 && candidate.slot <= 5)
            .slice(0, 6) ?? [];

          return (
            <div
              key={slot.slotId}
              className={`match-scoreboard-grid match-scoreboard-player${local ? ' is-local' : ''}${!hero ? ' is-empty' : ''}${dead ? ' is-dead' : ''}${detailed ? '' : ' is-compact'}`}
            >
              <div className="match-scoreboard-identity">
                <div className="match-scoreboard-portrait">
                  {portrait ? <img src={portrait} alt="" draggable={false} /> : <span>{hero?.heroName?.[0] ?? slot.index}</span>}
                  {dead && (
                    <em className="match-scoreboard-death">
                      {respawnSeconds !== null && respawnSeconds > 0 ? respawnSeconds : <Skull aria-hidden="true" />}
                    </em>
                  )}
                </div>
                <div>
                  <strong>{player?.displayName ?? (hero ? hero.ownerPlayerId : `Ranura ${slot.index}`)}</strong>
                  <span>{hero?.heroName ?? 'Sin héroe'}</span>
                </div>
                {player && !player.connected && <WifiOff className="match-scoreboard-disconnected" aria-label="Jugador desconectado" />}
                {local && <small>TÚ</small>}
              </div>

              <div className="match-scoreboard-level">{hero?.level ?? '—'}</div>
              <div className="match-scoreboard-kda"><b>{combat.kills}</b><i>/</i><b>{combat.deaths}</b><i>/</i><b>{combat.assists}</b></div>
              {detailed && (
                <>
                  <div className="match-scoreboard-lane"><b>{combat.lastHits}</b><i>/</i><span>{combat.denies}</span></div>
                  <div className="match-scoreboard-gold"><Coins aria-hidden="true" />{hero ? formatNumber(hero.gold) : '—'}</div>
                  <div className="match-scoreboard-networth">{hero ? formatNumber(heroNetWorth(hero)) : '—'}</div>
                </>
              )}
              <div className="match-scoreboard-items" aria-label="Objetos">
                {Array.from({ length: 6 }, (_, index) => {
                  const item = mainItems[index]?.item ?? null;
                  return (
                    <span key={index} className={item ? 'is-filled' : ''} title={item?.displayName ?? 'Hueco vacío'}>
                      {item && <img src={getItemIconDataUrl(item.definitionId)} alt="" draggable={false} />}
                      {item && (item.quantity ?? 1) > 1 && <b>{item.quantity}</b>}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function ScoreboardOverlay({
  match,
  nowMs,
  respawnReadyAtMs,
}: {
  match: MatchState;
  nowMs: number;
  respawnReadyAtMs: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<GameSettings>(() => getGameSettingsSnapshot());
  const [localStats, setLocalStats] = useState<CombatHudStats>(EMPTY_COMBAT_STATS);

  useEffect(() => subscribeCombatHudStats(setLocalStats), []);

  // The match clock belongs to the always-visible top HUD, directly below DAWNREACH.
  // ScoreboardOverlay already receives the authoritative match timestamp and the 100 ms HUD
  // tick, so keep the top clock synchronized from that same source instead of maintaining a
  // second timer with its own epoch.
  useEffect(() => {
    const clock = document.querySelector<HTMLElement>('.game-hud .match-clock b');
    if (!clock) return;
    clock.textContent = formatClock(Math.max(0, nowMs - match.createdAtMs));
  }, [match.createdAtMs, nowMs]);

  useEffect(() => {
    const onSettingsChanged = (event: Event) => {
      setSettings((event as CustomEvent<GameSettingsChangedDetail>).detail?.settings ?? getGameSettingsSnapshot());
    };
    const onMenuState = (event: Event) => {
      if ((event as CustomEvent<{ open?: boolean }>).detail?.open) setOpen(false);
    };
    window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, onSettingsChanged as EventListener);
    window.addEventListener(GAME_MENU_STATE_EVENT, onMenuState as EventListener);
    return () => {
      window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, onSettingsChanged as EventListener);
      window.removeEventListener(GAME_MENU_STATE_EVENT, onMenuState as EventListener);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || isEditableTarget(event.target) || isGameMenuOpen()) return;
      if (!settingBindingMatchesEvent(event, 'controls.scoreboard', settings)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!settingBindingMatchesEvent(event, 'controls.scoreboard', settings)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    const onBlur = () => setOpen(false);

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [settings]);

  if (!open) return null;

  const detailed = settings['interface.scoreboardDetailed'] !== false;
  const hotkey = formatKeyBinding(String(settings['controls.scoreboard'] ?? 'Tab'));

  return (
    <div className="match-scoreboard-overlay" role="dialog" aria-modal="false" aria-label="Marcador de la partida">
      <div className="match-scoreboard-window">
        <header className="match-scoreboard-header">
          <div><span>PARTIDA EN CURSO</span><strong>MARCADOR</strong></div>
          <div className="match-scoreboard-hint"><kbd>{hotkey}</kbd><span>Mantén para ver</span></div>
        </header>
        <TeamTable
          team="dawn"
          match={match}
          localStats={localStats}
          nowMs={nowMs}
          respawnReadyAtMs={respawnReadyAtMs}
          detailed={detailed}
        />
        <div className="match-scoreboard-divider"><span>VS</span></div>
        <TeamTable
          team="dusk"
          match={match}
          localStats={localStats}
          nowMs={nowMs}
          respawnReadyAtMs={respawnReadyAtMs}
          detailed={detailed}
        />
        <footer className="match-scoreboard-footer">
          <span>K/D/A · bajas / muertes / asistencias</span>
          {detailed && <span>LH/DN · últimos golpes / denegados · NW · patrimonio total</span>}
        </footer>
      </div>
    </div>
  );
}
