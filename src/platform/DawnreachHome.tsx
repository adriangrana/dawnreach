import { useState } from 'react';
import {
  ChevronDown,
  Crown,
  Gamepad2,
  MessageSquare,
  Plus,
  Settings,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  Users,
} from 'lucide-react';
import aldenPortrait from '../game/heroes/alden/images/H001.webp';
import aldenFullArt from '../game/heroes/alden/images/H001F.png';
import { HomeChatPanel } from './HomeChatPanel';
import { platformRealtime } from './realtimeClient';
import { SocialRail } from './SocialRail';
import type { PartySnapshot, PlatformUser, SocialSnapshot } from './types';

const DAWNREACH_ICON = '/assets/icon/dawnreach.png';

export function DawnreachHomeTopbar({
  section,
  user,
  realtime,
  onHome,
  onPlay,
  onLogout,
}: {
  section: 'home' | 'play';
  user: PlatformUser;
  realtime: 'connecting' | 'online' | 'offline';
  onHome: () => void;
  onPlay: () => void;
  onLogout: () => void;
}) {
  return <header className="platform-topbar dr-home-topbar">
    <button className="dr-home-mark" type="button" onClick={onHome} aria-label="Dawnreach home"><img src={DAWNREACH_ICON} alt="" /></button>
    <nav className="dr-home-nav" aria-label="Main navigation">
      <button className={section === 'home' ? 'is-active' : ''} onClick={onHome}>HOME</button>
      <button className={section === 'play' ? 'is-active' : ''} onClick={onPlay}>PLAY</button>
      <button disabled>HEROES</button>
      <button disabled>COLLECTION</button>
      <button disabled>RANKING</button>
      <button disabled>PROFILE</button>
    </nav>
    <div className="dr-home-top-actions">
      <span className="dr-home-top-stat"><Trophy /> <strong>{user.calibrated ? user.rating : user.calibrationGames}</strong><small>{user.calibrated ? 'MMR' : 'CAL.'}</small></span>
      <span className="dr-home-top-stat"><Shield /> <strong>{user.wins}</strong><small>WINS</small></span>
      <button className="dr-home-icon-button" type="button" disabled aria-label="Messages"><MessageSquare /></button>
      <button className="dr-home-icon-button" type="button" disabled aria-label="Settings"><Settings /></button>
      <span className="dr-home-account-avatar">{user.username.slice(0, 2).toUpperCase()}</span>
      <span className="dr-home-account-copy"><strong>{user.username}</strong><small><i className={`platform-presence is-${realtime}`} /> {realtime === 'online' ? 'Online' : realtime === 'connecting' ? 'Connecting…' : 'Offline'}</small></span>
      <button className="dr-home-account-menu" type="button" onClick={onLogout} title="Sign out"><ChevronDown /></button>
    </div>
  </header>;
}

export function DawnreachHomeOverview({
  user,
  party,
  online,
  social,
  selectedChatFriendId,
  refreshSocial,
  onActiveChatFriendChange,
  onPlay,
  onLocalPlay,
  onNormal,
  onRanked,
  onCustom,
}: {
  user: PlatformUser;
  party: PartySnapshot;
  online: readonly PlatformUser[];
  social: SocialSnapshot;
  selectedChatFriendId: string | null;
  refreshSocial: () => Promise<void>;
  onActiveChatFriendChange?: (userId: string | null) => void;
  onPlay: () => void;
  onLocalPlay: () => void;
  onNormal: () => void;
  onRanked: () => void;
  onCustom: () => void;
}) {
  const games = user.wins + user.losses;
  const calibrationProgress = Math.min(100, Math.round((user.calibrationGames / Math.max(1, user.calibrationTarget)) * 100));
  return <section className="dr-home-overview">
    <div className="dr-home-stage">
      <aside className="dr-home-left-column">
        <article className="dr-home-season-card">
          <div><small>SEASON I</small><h2>DAWN OF<br />THE REALMS</h2><p>The war for the two thrones has only just begun.</p></div>
          <button type="button" disabled>VIEW SEASON</button>
        </article>
        <article className="dr-home-progress-card">
          <div className="dr-home-progress-medal">{user.calibrated ? user.rating : user.calibrationGames}</div>
          <div><small>{user.calibrated ? 'RANKING' : 'CALIBRATION'}</small><strong>{user.calibrated ? `${user.rating} MMR` : `${user.calibrationGames} / ${user.calibrationTarget}`}</strong><span className="dr-home-progress-track"><i style={{ width: `${user.calibrated ? 100 : calibrationProgress}%` }} /></span></div>
        </article>
        <article className="dr-home-events-card">
          <header><strong>ACTIVITY</strong><button type="button" disabled>SEE ALL</button></header>
          <div><span className="dr-home-event-icon"><Swords /></span><p><strong>Open Frontier</strong><small>Normal Matchmaking available</small></p><em>NOW</em></div>
          <div><span className="dr-home-event-icon"><Trophy /></span><p><strong>Ranked</strong><small>{user.calibrated ? 'Defend your position' : 'Complete your calibration'}</small></p><em>{games} G.</em></div>
          <div><span className="dr-home-event-icon"><Users /></span><p><strong>War Council</strong><small>{party.party ? `Party ${party.party.members.length}/5` : 'Party 1/5'}</small></p><em>{online.length} ON</em></div>
        </article>
      </aside>

      <div className="dr-home-feature-hero" aria-hidden="true">
        <img src={aldenFullArt} alt="" draggable={false} />
      </div>

      <div className="dr-home-feature-copy">
        <span>FEATURED HERO</span>
        <h1>ALDEN</h1>
        <h3>THE IRON KING</h3>
        <p>Frontline initiator and sustained-damage fighter.</p>
        <button type="button" onClick={onPlay}>PREPARE FOR BATTLE</button>
      </div>

      <nav className="dr-home-mode-ribbon" aria-label="Game modes">
        <button type="button" onClick={onLocalPlay}><Gamepad2 /><span><strong>PRACTICE</strong><small>Test the battlefield</small></span></button>
        <button type="button" onClick={onNormal}><Shield /><span><strong>NORMAL</strong><small>Fight without pressure</small></span></button>
        <button className="is-primary" type="button" onClick={onPlay}><Swords /><span><strong>PLAY</strong><small>Choose your mode</small></span></button>
        <button type="button" onClick={onRanked} className="invert"><Trophy /><span><strong>RANKED</strong><small>Climb the ranks</small></span></button>
        <button type="button" onClick={onCustom}><Sparkles /><span><strong>CUSTOM</strong><small>Your rules, your lobby</small></span></button>
      </nav>
    </div>

    <div className="dr-home-lower-strip">
      <article className="dr-home-news-card is-wide"><div><small>DAWNREACH CHRONICLES</small><strong>Beyond the battlefield</strong><span>Discover the realms fighting to control the crown.</span></div></article>
      <article className="dr-home-news-card is-hero"><img src={aldenPortrait} alt="Alden" /><div><small>HERO</small><strong>Alden</strong></div></article>
      <article className="dr-home-news-card is-update"><div><small>UPDATE</small><strong>Foundation Season</strong></div></article>
      <HomeChatPanel me={user} online={online} snapshot={social} party={party} selectedFriendId={selectedChatFriendId} refreshSocial={refreshSocial} onActiveDirectChange={onActiveChatFriendChange} />
      <article className="dr-home-motto-card"><Crown /><strong>TWO REALMS.<br />ONE THRONE.</strong><span>DAWNREACH</span></article>
    </div>
  </section>;
}

export function DawnreachHomeRightRail({
  me,
  online,
  snapshot,
  party,
  refresh,
  activeConversationId,
  onOpenConversation,
}: {
  me: PlatformUser;
  online: readonly PlatformUser[];
  snapshot: SocialSnapshot;
  party: PartySnapshot;
  refresh: () => Promise<void>;
  activeConversationId?: string | null;
  onOpenConversation?: (userId: string) => void;
}) {
  const [inviteName, setInviteName] = useState('');
  const activeParty = party.party;
  const members = activeParty?.members ?? [me];
  const leaderId = activeParty?.leaderId ?? me.id;
  const isLeader = leaderId === me.id;
  const invite = () => {
    const username = inviteName.trim();
    if (!username || !isLeader) return;
    if (platformRealtime.send('party.invite', { username })) setInviteName('');
  };

  return <aside className="dr-home-right-rail">
    <section className="dr-home-party-card">
      <header><strong>PARTY</strong><span>{members.length}/5</span></header>
      <div className="dr-home-party-slots">
        {Array.from({ length: 5 }, (_, index) => {
          const member = members[index];
          return <span key={member?.id ?? `empty-${index}`} className={member ? 'is-filled' : ''}>{member ? <><b>{member.username.slice(0, 2).toUpperCase()}</b>{leaderId === member.id && <Crown />}</> : <Plus />}</span>;
        })}
      </div>
      {isLeader ? <div className="dr-home-party-invite"><input value={inviteName} onChange={event => setInviteName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); invite(); } }} placeholder="Invite by username" /><button type="button" onClick={invite}>INVITE</button></div> : <button className="dr-home-party-main" type="button" onClick={() => platformRealtime.send('party.leave')}>LEAVE PARTY</button>}
      {activeParty && activeParty.members.length > 1 && isLeader && <button className="dr-home-party-leave" type="button" onClick={() => platformRealtime.send('party.leave')}>Leave party</button>}
    </section>
    <SocialRail me={me} online={online} snapshot={snapshot} party={party} refresh={refresh} activeConversationId={activeConversationId} onOpenConversation={onOpenConversation} />
  </aside>;
}
