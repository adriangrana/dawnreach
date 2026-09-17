import { useState } from 'react';
import { Crown, UserPlus } from 'lucide-react';
import type { PartySnapshot, PlatformUser } from './types';
import { platformRealtime } from './realtimeClient';

export function PartyBar({ me, snapshot }: { me: PlatformUser; snapshot: PartySnapshot }) {
  const [invite, setInvite] = useState('');
  const party = snapshot.party;
  const members = party?.members ?? [me];
  const leaderId = party?.leaderId ?? me.id;
  const isLeader = leaderId === me.id;

  const submitInvite = () => {
    const username = invite.trim();
    if (!username || !isLeader) return;
    if (platformRealtime.send('party.invite', { username })) setInvite('');
  };

  return <section className="platform-party-bar is-active">
    <div className="platform-party-members">
      <span className="platform-party-code">PARTY {party?.code ?? 'SOLO'}</span>
      {members.map(member => <span className="platform-party-member" key={member.id}>
        <span className="platform-party-avatar">{member.username.slice(0, 2).toUpperCase()}</span>
        {member.username}
        {member.id === leaderId && <Crown size={11} />}
      </span>)}
    </div>
    {isLeader && <div className="platform-party-invite">
      <input aria-label="Username to invite" value={invite} onChange={event => setInvite(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submitInvite(); } }} placeholder="Invite username" />
      <button type="button" aria-label="Invite to party" onClick={submitInvite}><UserPlus size={15} /></button>
    </div>}
    {party && party.members.length > 1 && <button className="platform-party-leave" type="button" onClick={() => platformRealtime.send('party.leave')}>Leave</button>}
  </section>;
}
