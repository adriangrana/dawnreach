import { useEffect, useRef, type RefObject, type SyntheticEvent } from 'react';
import { Coins, Crosshair, Diamond, Eye, Shield, Sparkles, Sword, Swords, ZoomIn } from 'lucide-react';
import { createDawnreachGame } from './game/createDawnreachGame';

const ALDEN_PORTRAIT_SRC = new URL('./game/heroes/alden/images/H001.png', import.meta.url).href;
const ALDEN_MINIMAP_SRC = new URL('./game/heroes/alden/images/H001I.png', import.meta.url).href;
const HUD_ART_SRC = new URL('./assets/hud-art.svg', import.meta.url).href;
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
const abilities = [
  { key: 'Q', art: 'blade', cooldown: '' },
  { key: 'W', art: 'aegis', cooldown: '9' },
  { key: 'E', art: 'banner', cooldown: '14' },
  { key: 'R', art: 'sun', cooldown: '' },
].map(ability => ({
  ...ability,
  image: heroAbilityImages[`./game/heroes/alden/images/H001${ability.key}.png`],
}));
const inventory = ['boots', 'blade', 'gem', 'potion', 'ring', 'scroll'];

function HudArt({ name }: { name: string }) {
  return <svg className="hud-art" viewBox="0 0 100 100" aria-hidden="true"><use href={`${HUD_ART_SRC}#${name}`} /></svg>;
}

function hideMissingImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = 'none';
}

function TeamPortraits({ team, side }: { team: TeamHero[]; side: 'dawn' | 'dusk' }) {
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
          <span className="top-hero-level">{index === 0 && side === 'dawn' ? 11 : 10}</span>
        </div>
      ))}
    </div>
  );
}

function GameHud({
  minimapRef,
  minimapHeroRef,
}: {
  minimapRef: RefObject<HTMLDivElement | null>;
  minimapHeroRef: RefObject<HTMLImageElement | null>;
}) {
  return (
    <div className="game-hud" aria-hidden="true">
      <section className="scoreboard">
        <TeamPortraits team={dawnTeam} side="dawn" />
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
            <span className="hero-level">11</span>
          </div>
          <div className="hero-identity">
            <strong>Alden</strong>
            <span>Vanguard</span>
            <div className="hero-attributes">
              <b><Sword />62</b>
              <b><Sparkles />38</b>
              <b><Shield />51</b>
            </div>
            <div className="hero-sigil"><HudArt name="sun" /></div>
          </div>
        </div>

        <div className="combat-panel">
          <div className="ability-row">
            {abilities.map((ability) => (
              <div className={`ability-slot ability-slot--${ability.art}${ability.cooldown ? ' is-cooling' : ''}`} key={ability.key} data-ability={ability.key}>
                {ability.image ? (
                  <img className="ability-image" src={ability.image} alt="" draggable={false} />
                ) : (
                  <HudArt name={ability.art} />
                )}
                {ability.cooldown && <b className="ability-cooldown">{ability.cooldown}</b>}
                <i>{ability.key}</i>
              </div>
            ))}
          </div>
          <div className="resource-bars">
            <div className="resource resource--health">
              <span style={{ width: `${1628 / 1780 * 100}%` }} />
              <b>1628 / 1780</b>
            </div>
            <div className="resource resource--mana">
              <span style={{ width: `${612 / 780 * 100}%` }} />
              <b>612 / 780</b>
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
    </div>
  );
}

export default function App() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const minimapHeroRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const minimapHost = minimapRef.current;
    const minimapHeroMarker = minimapHeroRef.current;
    if (!host || !minimapHost) return;

    let disposed = false;
    let destroy: (() => void) | undefined;

    void createDawnreachGame(host, minimapHost, minimapHeroMarker).then((game) => {
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
      <GameHud minimapRef={minimapRef} minimapHeroRef={minimapHeroRef} />
    </main>
  );
}
