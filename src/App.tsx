import { useEffect, useReducer, useRef, type Dispatch, type RefObject, type SyntheticEvent } from 'react';
import { Coins, Crosshair, Diamond, Eye, Shield, Sparkles, Sword, Swords, ZoomIn } from 'lucide-react';
import { createDawnreachGame } from './game/createDawnreachGame';
import {
  publishWorldEntityRuntime,
  subscribeWorldCombatEvents,
  type WorldCombatEvent,
} from './game/entities/worldCombatBridge';
import AbilityButton from './hud/AbilityButton';
import {
  ABILITY_KEYS, ALDEN, LOCAL_HERO_ENTITY_ID, calculateAldenInnate, calculateHeroStats,
  createPlayableMatch, getAbilityControl, getHeroDefinition, getRequiredHero,
  recoverHeroResource, useHeroAbility, type AbilityKey, type MatchState,
} from './game/match';

const ALDEN_PORTRAIT_SRC = new URL('./game/heroes/alden/images/H001.png', import.meta.url).href;
const ALDEN_MINIMAP_SRC = new URL('./game/heroes/alden/images/H001I.png', import.meta.url).href;
const HUD_ART_SRC = new URL('./assets/hud-art.svg', import.meta.url).href;
const LOCAL_WORLD_HERO_ENTITY_ID = 'blue-hero-alden';
const heroAbilityImages = import.meta.glob<string>('./game/heroes/*/images/*[QWER].png', {
  eager: true,
  query: '?url',
  import: 'default',
});

type TeamHero = {
  initial: string;
  portrait?: string;
};

const dawnTeam: TeamHero[] = [
  { initial: 'A', portrait: ALDEN_PORTRAIT_SRC },
  { initial: 'S' },
  { initial: 'K' },
  { initial: 'L' },
  { initial: 'M' },
];
const duskTeam: TeamHero[] = [
  { initial: 'V' },
  { initial: 'N' },
  { initial: 'D' },
  { initial: 'T' },
  { initial: 'R' },
];
const abilityArt: Record<AbilityKey, string> = { Q: 'blade', W: 'aegis', E: 'banner', R: 'sun' };
const heroImageCodes: Record<string, string> = { H001: 'H001' };
const inventory = ['boots', 'blade', 'gem', 'potion', 'ring', 'scroll'];

type HudRuntime = { match: MatchState; nowMs: number; feedback: string };
type HudAction =
  | { type: 'tick'; nowMs: number }
  | { type: 'cast'; key: AbilityKey; nowMs: number }
  | { type: 'world-hero-sync'; event: WorldCombatEvent };

function updateHudRuntime(runtime: HudRuntime, action: HudAction): HudRuntime {
  const actionNowMs = action.type === 'world-hero-sync' ? action.event.atMs : action.nowMs;
  const nowMs = Math.max(runtime.nowMs, actionNowMs);
  const match = recoverHeroResource(runtime.match, LOCAL_HERO_ENTITY_ID, nowMs - runtime.nowMs, nowMs);

  if (action.type === 'tick') return { ...runtime, match, nowMs };

  if (action.type === 'world-hero-sync') {
    const hero = getRequiredHero(match, LOCAL_HERO_ENTITY_ID);
    const stats = calculateHeroStats(match, hero.heroEntityId, { nowMs });
    const currentHp = Math.max(0, Math.min(stats.maxHp, action.event.currentHp));
    const currentResource = action.event.currentResource === undefined
      ? hero.currentResource
      : Math.max(0, Math.min(stats.maxResource, action.event.currentResource));
    const nextHero = { ...hero, currentHp, currentResource };
    const feedback = action.event.reason === 'death'
      ? `${hero.heroName} ha caído. Reaparición en ${Math.ceil(action.event.respawnSeconds ?? 0)} s.`
      : action.event.reason === 'respawn'
        ? `${hero.heroName} ha reaparecido en la base.`
        : runtime.feedback;
    return {
      match: {
        ...match,
        heroes: { ...match.heroes, [LOCAL_HERO_ENTITY_ID]: nextHero },
      },
      nowMs,
      feedback,
    };
  }

  const control = getAbilityControl(match, LOCAL_HERO_ENTITY_ID, action.key, nowMs);
  return {
    match: useHeroAbility(match, LOCAL_HERO_ENTITY_ID, action.key, nowMs),
    nowMs,
    feedback: `${control.ability.name}: ${control.blockedReason ?? 'activada'}`,
  };
}

function HudArt({ name }: { name: string }) {
  return <svg className="hud-art" viewBox="0 0 100 100" aria-hidden="true"><use href={`${HUD_ART_SRC}#${name}`} /></svg>;
}

function hideMissingImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = 'none';
}

function TeamPortraits({ team, side, heroLevel = 11 }: { team: TeamHero[]; side: 'dawn' | 'dusk'; heroLevel?: number }) {
  return (
    <div className={`team-portraits team-portraits--${side}`}>
      {team.map((hero, index) => (
        <div className="top-hero-slot" key={`${side}-${index}`}>
          <div className="top-hero-face">
            <Shield className="top-hero-silhouette" />
            <span>{hero.initial}</span>
            {hero.portrait && (
              <img
                className="top-hero-image"
                src={hero.portrait}
                alt=""
                draggable={false}
                onError={hideMissingImage}
              />
            )}
          </div>
          <span className="top-hero-level">{index === 0 && side === 'dawn' ? heroLevel : 10}</span>
        </div>
      ))}
    </div>
  );
}

function GameHud({
  minimapRef,
  minimapHeroRef,
  runtime,
  dispatch,
}: {
  minimapRef: RefObject<HTMLDivElement | null>;
  minimapHeroRef: RefObject<HTMLImageElement | null>;
  runtime: HudRuntime;
  dispatch: Dispatch<HudAction>;
}) {
  const hero = getRequiredHero(runtime.match, LOCAL_HERO_ENTITY_ID);
  const definition = getHeroDefinition(hero.definitionId);
  const stats = calculateHeroStats(runtime.match, hero.heroEntityId, { nowMs: runtime.nowMs });
  const innate = hero.definitionId === ALDEN.id ? calculateAldenInnate(runtime.match, hero.heroEntityId) : null;

  useEffect(() => {
    const timer = window.setInterval(() => dispatch({ type: 'tick', nowMs: performance.now() }), 100);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const key = event.key.toUpperCase() as AbilityKey;
      if (!ABILITY_KEYS.includes(key)) return;
      event.preventDefault();
      dispatch({ type: 'cast', key, nowMs: performance.now() });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div className="game-hud">
      <section className="scoreboard">
        <TeamPortraits team={dawnTeam} side="dawn" heroLevel={hero.level} />
        <div className="match-score">
          <strong className="score score--dawn">0</strong>
          <div className="match-clock">
            <span>DAWNREACH</span>
            <b>00:00</b>
          </div>
          <strong className="score score--dusk">0</strong>
        </div>
        <TeamPortraits team={duskTeam} side="dusk" />
      </section>

      <section className="minimap-shell">
        <div className="minimap-field">
          <div
            ref={minimapRef}
            className="minimap-live"
            style={{ position: 'absolute', inset: 0, zIndex: 10, overflow: 'hidden', background: '#07100e' }}
          />
          <img
            ref={minimapHeroRef}
            className="minimap-hero-icon"
            src={ALDEN_MINIMAP_SRC}
            alt=""
            draggable={false}
            onError={hideMissingImage}
          />
        </div>
        <div className="minimap-tools">
          <span><ZoomIn /></span>
          <span><Eye /></span>
          <span><Crosshair /></span>
        </div>
        <Diamond className="minimap-ornament" />
      </section>

      <section className="command-deck">
        <div className="hero-panel">
          <div className="hero-portrait">
            <span className="hero-portrait__crest">A</span>
            <img
              className="hero-portrait__image"
              src={ALDEN_PORTRAIT_SRC}
              alt=""
              draggable={false}
              onError={hideMissingImage}
            />
            <span className="hero-level">{hero.level}</span>
          </div>
          <div className="hero-identity">
            <strong>{definition.displayName}</strong>
            <span>{definition.className}</span>
            <div className="hero-attributes">
              <b><Sword />{Math.round(stats.attackDamage)}</b>
              <b><Sparkles />{Math.round(stats.magicResistance)}</b>
              <b><Shield />{Math.round(stats.physicalArmor)}</b>
            </div>
            {innate && <div className="hero-sigil">
              <AbilityButton
                name={ALDEN.innate.name} kind="passive" art="sun" blockedReason="Pasiva innata"
                description={`Al recibir impactos frontales acumula hasta ${innate.requiredStacks} cargas. Potencia el siguiente ataque con ${Math.round(innate.bonusDamage)} de dano adicional y hasta ${Math.round(innate.healing)} de curacion. Intervalo entre cargas: ${innate.stackInternalCooldownSeconds} s. Bloqueo tras activarse: ${innate.procLockoutSeconds} s.`}
              ><HudArt name="sun" /></AbilityButton>
            </div>}
          </div>
        </div>

        <div className="combat-panel">
          <div className="ability-row">
            {ABILITY_KEYS.map(key => {
              const control = getAbilityControl(runtime.match, hero.heroEntityId, key, runtime.nowMs);
              const ability = control.ability;
              return <AbilityButton
                key={key} hotkey={key} name={ability.name} kind={ability.type}
                description={ability.technicalDescription} lore={ability.lore}
                rank={control.rank} maxRank={ability.unlockLevels.length} nextLevel={ability.unlockLevels[control.rank]}
                remainingMs={control.remainingMs} cooldownSeconds={control.preview?.cooldownSeconds}
                resourceCost={control.preview?.resourceCost} resourceName={definition.resource.displayName}
                blockedReason={control.blockedReason} art={abilityArt[key]}
                image={heroAbilityImages[`./game/heroes/${hero.heroName?.toLowerCase()}/images/${heroImageCodes[hero.definitionId]}${key}.png`]}
                onUse={() => dispatch({ type: 'cast', key, nowMs: performance.now() })}
              ><HudArt name={abilityArt[key]} /></AbilityButton>;
            })}
          </div>
          <div className="resource-bars">
            <div className="resource resource--health">
              <span style={{ width: `${hero.currentHp / stats.maxHp * 100}%` }} />
              <b>{Math.floor(hero.currentHp)} / {Math.round(stats.maxHp)}</b>
            </div>
            <div className="resource resource--mana" data-current={hero.currentResource} data-max={stats.maxResource}>
              <span style={{ width: `${hero.currentResource / stats.maxResource * 100}%` }} />
              <b>{Math.floor(hero.currentResource)} / {Math.round(stats.maxResource)}</b>
            </div>
          </div>
        </div>

        <div className="inventory-panel">
          <div className="inventory-grid">
            {inventory.map((item, index) => (
              <div className={`inventory-slot inventory-slot--${item}`} key={item}>
                <HudArt name={item} />
                <span className="item-key">{index + 1}</span>
              </div>
            ))}
          </div>
          <div className="gold-row">
            <Coins />
            <strong>1240</strong>
          </div>
        </div>
        <div className="deck-crest"><Swords /></div>
      </section>
      <div className="hud-feedback" role="status" aria-live="polite">{runtime.feedback}</div>
    </div>
  );
}

export default function App() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const minimapHeroRef = useRef<HTMLImageElement | null>(null);
  const [runtime, dispatch] = useReducer(updateHudRuntime, undefined, () => {
    const nowMs = performance.now();
    return { match: createPlayableMatch('H001', 11, nowMs), nowMs, feedback: '' };
  });
  const getOverlayState = () => ({
    hero: getRequiredHero(runtime.match, LOCAL_HERO_ENTITY_ID),
    stats: calculateHeroStats(runtime.match, LOCAL_HERO_ENTITY_ID, { nowMs: runtime.nowMs }),
  });
  const overlayStateRef = useRef<ReturnType<typeof getOverlayState> | null>(null);

  useEffect(() => {
    const overlay = getOverlayState();
    overlayStateRef.current = overlay;
    publishWorldEntityRuntime(LOCAL_WORLD_HERO_ENTITY_ID, {
      level: overlay.hero.level,
      maxHp: overlay.stats.maxHp,
      currentHp: overlay.hero.currentHp,
      maxResource: overlay.stats.maxResource,
      currentResource: overlay.hero.currentResource,
      alive: overlay.hero.currentHp > 0,
    });
  }, [runtime]);

  useEffect(() => subscribeWorldCombatEvents((event) => {
    if (event.entityId !== LOCAL_WORLD_HERO_ENTITY_ID) return;
    dispatch({ type: 'world-hero-sync', event });
  }), []);

  useEffect(() => {
    const host = hostRef.current;
    const minimapHost = minimapRef.current;
    const minimapHeroMarker = minimapHeroRef.current;
    if (!host || !minimapHost) return;

    let disposed = false;
    let destroy: (() => void) | undefined;

    void createDawnreachGame(host, minimapHost, minimapHeroMarker, () => overlayStateRef.current).then((game) => {
      if (disposed) {
        game.destroy();
        return;
      }
      destroy = game.destroy;
    });

    return () => {
      disposed = true;
      destroy?.();
    };
  }, []);

  return (
    <main className="app-shell">
      <div ref={hostRef} className="game-host" />
      <GameHud minimapRef={minimapRef} minimapHeroRef={minimapHeroRef} runtime={runtime} dispatch={dispatch} />
    </main>
  );
}
