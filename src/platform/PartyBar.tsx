import { useState } from 'react';
import { Crown, Plus, UserPlus, Users } from 'lucide-react';
import type { PartySnapshot, PlatformUser } from './types';
import { platformRealtime } from './realtimeClient';

export function PartyBar({ me, snapshot }: { me: PlatformUser; snapshot: PartySnapshot }) {
  const [invite, setInvite] = useState('');
  const party = snapshot.party;

  if (!party) {
    return <section className="platform-party-bar">
      <div className="platform-party-intro"><Users size={18} /><span><strong>Play with friends</strong><small>Create a party of up to 5 players and queue together.</small></span></div>
      <button className="platform-party-secondary" type="button" onClick={() => platformRealtime.send('party.create')}><Plus size={15} /> Create Party</button>
    </section>;
  }

  const isLeader = party.leaderId === me.id;
  const submitInvite = () => {
    const username = invite.trim();
    if (!username) return;
    if (platformRealtime.send('party.invite', { username })) setInvite('');
  };

  return <section className="platform-party-bar is-active">
    <div className="platform-party-members">
      <span className="platform-party-code">PARTY {party.code}</span>
      {party.members.map(member => <span className="platform-party-member" key={member.id}>
        <span className="platform-party-avatar">{member.username.slice(0, 2).toUpperCase()}</span>
        {member.username}
        {member.id === party.leaderId && <Crown size={11} />}
      </span>)}
    </div>
    {isLeader && <div className="platform-party-invite">
      <input aria-label="Username to invite" value={invite} onChange={event => setInvite(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submitInvite(); } }} placeholder="Invite username" />
      <button type="button" aria-label="Invite to party" onClick={submitInvite}><UserPlus size={15} /></button>
    </div>}
    <button className="platform-party-leave" type="button" onClick={() => platformRealtime.send('party.leave')}>Leave</button>
  </section>;
}
