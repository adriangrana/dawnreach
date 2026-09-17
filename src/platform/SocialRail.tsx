import { Check, MessageCircle, Search, UserPlus, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  getDirectConversation,
  platformRealtime,
  respondPlatformFriendRequest,
  searchPlatformUsers,
  sendPlatformDirectMessage,
  sendPlatformFriendRequest,
  type DirectMessage,
  type PartySnapshot,
  type PlatformRealtimeEvent,
  type PlatformUser,
  type SocialSnapshot,
} from './index';

function eventType(event: PlatformRealtimeEvent) {
  return typeof event === 'object' && event !== null && 'type' in event ? String(event.type || '') : '';
}

export function SocialRail({
  me,
  online,
  snapshot,
  party,
  refresh,
}: {
  me: PlatformUser;
  online: readonly PlatformUser[];
  snapshot: SocialSnapshot;
  party: PartySnapshot;
  refresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly PlatformUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly DirectMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const selected = useMemo(() => snapshot.friends.find(friend => friend.id === selectedId) ?? null, [snapshot.friends, selectedId]);
  const onlineIds = useMemo(() => new Set(online.map(user => user.id)), [online]);

  useEffect(() => platformRealtime.subscribe(event => {
    if (eventType(event) !== 'direct.message' || !('message' in event)) return;
    const incoming = event.message as DirectMessage;
    if (!selectedId || (incoming.fromUserId !== selectedId && incoming.toUserId !== selectedId)) return;
    setMessages(previous => previous.some(item => item.id === incoming.id) ? previous : [...previous, incoming]);
  }), [selectedId]);

  const openConversation = async (userId: string) => {
    setSelectedId(userId);
    setNotice('');
    try { setMessages(await getDirectConversation(userId)); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo cargar la conversación.'); }
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setNotice('');
    try { setResults(await searchPlatformUsers(query)); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo buscar.'); }
  };

  const addFriend = async (userId: string) => {
    try { await sendPlatformFriendRequest(userId); setResults(current => current.filter(user => user.id !== userId)); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo enviar la solicitud.'); }
  };

  const respondFriend = async (requestId: string, accept: boolean) => {
    try { await respondPlatformFriendRequest(requestId, accept); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo responder.'); }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    try {
      const sent = await sendPlatformDirectMessage(selected.id, draft.trim());
      setMessages(previous => previous.some(item => item.id === sent.id) ? previous : [...previous, sent]);
      setDraft('');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo enviar el mensaje.'); }
  };

  return <aside className="platform-social-rail">
    <header className="platform-social-rail-head"><div><Users /><span><strong>AMIGOS</strong><small>{online.length} conectados</small></span></div><span className="platform-social-live-dot" /></header>
    <form className="platform-social-search" onSubmit={search}><Search /><input aria-label="Buscar jugador" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar jugador…" /><button aria-label="Buscar">↵</button></form>

    {results.length > 0 && <div className="platform-social-search-results">{results.map(user => <div key={user.id}><span className="platform-social-avatar">{user.username.slice(0, 2).toUpperCase()}</span><strong>{user.username}</strong><button type="button" onClick={() => void addFriend(user.id)}><UserPlus /></button></div>)}</div>}

    {(party.invites.length > 0 || snapshot.incoming.length > 0) && <section className="platform-social-requests"><h4>INVITACIONES</h4>
      {party.invites.map(invite => <div key={invite.id} className="platform-social-request"><span className="platform-social-avatar is-party"><Users /></span><span><strong>{invite.from?.username ?? 'Jugador'}</strong><small>Invitación de grupo</small></span><button type="button" onClick={() => platformRealtime.send('party.accept', { inviteId: invite.id })}><Check /></button><button type="button" onClick={() => platformRealtime.send('party.decline', { inviteId: invite.id })}><X /></button></div>)}
      {snapshot.incoming.map(request => <div key={request.id} className="platform-social-request"><span className="platform-social-avatar">{request.user?.username.slice(0, 2).toUpperCase() ?? 'DR'}</span><span><strong>{request.user?.username ?? 'Jugador'}</strong><small>Solicitud de amistad</small></span><button type="button" onClick={() => void respondFriend(request.id, true)}><Check /></button><button type="button" onClick={() => void respondFriend(request.id, false)}><X /></button></div>)}
    </section>}

    <section className="platform-social-friends"><h4>AMIGOS · {snapshot.friends.length}</h4><div>{snapshot.friends.map(friend => <button type="button" key={friend.id} className={selectedId === friend.id ? 'is-selected' : ''} onClick={() => void openConversation(friend.id)}><span className="platform-social-avatar">{friend.username.slice(0, 2).toUpperCase()}</span><span><strong>{friend.username}</strong><small>{onlineIds.has(friend.id) ? 'En línea' : 'Desconectado'}</small></span><i className={onlineIds.has(friend.id) ? 'is-online' : ''} />{friend.unread > 0 && <em>{friend.unread}</em>}</button>)}{snapshot.friends.length === 0 && <p className="platform-social-empty">Busca jugadores para empezar tu lista.</p>}</div></section>

    {snapshot.outgoing.length > 0 && <section className="platform-social-pending"><h4>PENDIENTES</h4>{snapshot.outgoing.map(request => <p key={request.id}>{request.user?.username ?? 'Jugador'}</p>)}</section>}

    {notice && <p className="platform-social-notice">{notice}</p>}

    {selected && <section className="platform-social-drawer" aria-label={`Conversación con ${selected.username}`}>
      <header><div><span className="platform-social-avatar">{selected.username.slice(0, 2).toUpperCase()}</span><span><strong>{selected.username}</strong><small>{onlineIds.has(selected.id) ? 'En línea' : 'Desconectado'}</small></span></div><button type="button" onClick={() => setSelectedId(null)}><X /></button></header>
      <div className="platform-social-messages">{messages.length === 0 && <p>Todavía no hay mensajes.</p>}{messages.map(message => <div key={message.id} className={message.fromUserId === me.id ? 'is-mine' : ''}><span>{message.text}</span><small>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>)}</div>
      <form onSubmit={sendMessage}><MessageCircle /><input value={draft} onChange={event => setDraft(event.target.value)} maxLength={500} placeholder={`Mensaje a ${selected.username}`} /><button>Enviar</button></form>
    </section>}
  </aside>;
}
