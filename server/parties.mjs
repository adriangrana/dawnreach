import { randomToken } from './security.mjs';

function cleanPartyMessage(value) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 500);
}

export class PartyManager {
  constructor(options) {
    this.options = options;
    this.parties = new Map();
    this.invites = new Map();
    this.messages = new Map();
  }

  partyForUser(userId) {
    return [...this.parties.values()].find(party => party.members.includes(userId)) || null;
  }

  snapshotFor(userId) {
    const party = this.partyForUser(userId);
    const invites = [...this.invites.values()]
      .filter(invite => invite.toUserId === userId)
      .map(invite => ({
        ...invite,
        from: this.options.store.publicUser(this.options.store.getUser(invite.fromUserId)),
      }));
    return {
      party: party ? this.publicParty(party) : null,
      invites,
      messages: party ? this.messagesForParty(party.id) : [],
    };
  }

  create(leader) {
    const existing = this.partyForUser(leader.id);
    if (existing) return existing;
    let code = this.code();
    while ([...this.parties.values()].some(party => party.code === code)) code = this.code();
    const party = {
      id: randomToken(8),
      code,
      leaderId: leader.id,
      members: [leader.id],
      createdAt: new Date().toISOString(),
    };
    this.parties.set(party.id, party);
    this.messages.set(party.id, []);
    this.emitParty(party);
    return party;
  }

  invite(fromUserId, username) {
    const party = this.partyForUser(fromUserId);
    if (!party) throw new Error('Crea un grupo primero.');
    if (party.leaderId !== fromUserId) throw new Error('Solo el líder puede invitar jugadores.');
    const target = this.options.store.findByUsername(username);
    if (!target) throw new Error('Jugador no encontrado.');
    if (party.members.includes(target.id)) throw new Error('Ese jugador ya está en el grupo.');
    if (party.members.length >= 5) throw new Error('El grupo ya tiene 5 jugadores.');

    for (const [id, invite] of this.invites) {
      if (invite.partyId === party.id && invite.toUserId === target.id) this.invites.delete(id);
    }

    const invite = {
      id: randomToken(6),
      partyId: party.id,
      fromUserId,
      toUserId: target.id,
      createdAt: new Date().toISOString(),
    };
    this.invites.set(invite.id, invite);
    this.options.onEvent({
      type: 'party.invite',
      invite: {
        ...invite,
        from: this.options.store.publicUser(this.options.store.getUser(fromUserId)),
        party: this.publicParty(party),
      },
    }, [target.id]);
    this.emitSnapshot(target.id);
    return invite;
  }

  accept(userId, inviteId) {
    const invite = this.invites.get(inviteId);
    if (!invite || invite.toUserId !== userId) throw new Error('Invitación de grupo no encontrada.');
    const party = this.parties.get(invite.partyId);
    if (!party) throw new Error('Ese grupo ya no existe.');
    if (party.members.length >= 5) throw new Error('El grupo ya está completo.');

    this.leave(userId);
    party.members.push(userId);
    this.invites.delete(invite.id);
    this.emitParty(party);
    return party;
  }

  decline(userId, inviteId) {
    const invite = this.invites.get(inviteId);
    if (!invite || invite.toUserId !== userId) throw new Error('Invitación de grupo no encontrada.');
    this.invites.delete(invite.id);
    this.emitSnapshot(userId);
  }

  leave(userId) {
    const party = this.partyForUser(userId);
    if (!party) return;
    party.members = party.members.filter(id => id !== userId);
    if (!party.members.length) {
      this.parties.delete(party.id);
      this.messages.delete(party.id);
      for (const [id, invite] of this.invites) {
        if (invite.partyId === party.id) this.invites.delete(id);
      }
      this.emitSnapshot(userId);
      return;
    }
    if (party.leaderId === userId) party.leaderId = party.members[0];
    this.emitParty(party);
    this.emitSnapshot(userId);
  }

  sendMessage(userId, text) {
    const party = this.partyForUser(userId);
    if (!party) throw new Error('Debes estar en un grupo para usar el chat de grupo.');
    const clean = cleanPartyMessage(text);
    if (!clean) throw new Error('El mensaje está vacío.');
    const sender = this.options.store.publicUser(this.options.store.getUser(userId));
    if (!sender) throw new Error('Jugador no encontrado.');

    const message = {
      id: randomToken(12),
      partyId: party.id,
      fromUserId: userId,
      username: sender.username,
      text: clean,
      createdAt: new Date().toISOString(),
    };
    const history = this.messages.get(party.id) || [];
    history.push(message);
    if (history.length > 100) history.splice(0, history.length - 100);
    this.messages.set(party.id, history);
    this.options.onEvent({ type: 'party.message', message: { ...message } }, party.members);
    return { ...message };
  }

  messagesForParty(partyId) {
    return (this.messages.get(partyId) || []).map(message => ({ ...message }));
  }

  membersAsUsers(party) {
    return party.members
      .map(id => this.options.store.competitiveUser(this.options.store.getUser(id)))
      .filter(Boolean);
  }

  emitSnapshot(userId) {
    this.options.onEvent({ type: 'party.snapshot', ...this.snapshotFor(userId) }, [userId]);
  }

  emitParty(party) {
    for (const memberId of party.members) this.emitSnapshot(memberId);
  }

  publicParty(party) {
    return {
      ...party,
      members: party.members
        .map(id => this.options.store.publicUser(this.options.store.getUser(id)))
        .filter(Boolean),
    };
  }

  code() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  }
}
