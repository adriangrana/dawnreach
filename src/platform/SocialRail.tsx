import { Check, MessageCircle, Search, UserPlus, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
import { resolveFriendPresence } from './presence';

function eventType(event: PlatformRealtimeEvent) {
  return typeof event === 'object' && event !== null && 'type' in event ? String(event.type || '') : '';
}

export function SocialRail({
  me,
  online,
  snapshot,
  party,
  refresh,
  activeConversationId = null,
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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly PlatformUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly DirectMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const searchSequence = useRef(0);

  const selected = useMemo(() => snapshot.friends.find(friend => friend.id === selectedId) ?? null, [snapshot.friends, selectedId]);
  const onlineIds = useMemo(() => new Set(online.map(user => user.id)), [online]);
  const friendIds = useMemo(() => new Set(snapshot.friends.map(friend => friend.id)), [snapshot.friends]);
  const outgoingIds = useMemo(() => new Set(snapshot.outgoing.map(request => request.toUserId)), [snapshot.outgoing]);
  const incomingIds = useMemo(() => new Set(snapshot.incoming.map(request => request.fromUserId)), [snapshot.incoming]);
  const availableFriendCount = useMemo(
    () => snapshot.friends.filter(friend => resolveFriendPresence(friend, onlineIds).status !== 'offline').length,
    [snapshot.friends, onlineIds],
  );

  useEffect(() => {
    if (onOpenConversation) setSelectedId(null);
  }, [onOpenConversation]);

  useEffect(() => platformRealtime.subscribe(event => {
    if (eventType(event) !== 'direct.message' || !('message' in event)) return;
    const incoming = event.message as DirectMessage;
    if (!selectedId || (incoming.fromUserId !== selectedId && incoming.toUserId !== selectedId)) return;
    setMessages(previous => previous.some(item => item.id === incoming.id) ? previous : [...previous, incoming]);
  }), [selectedId]);

  useEffect(() => {
    const term = query.trim();
    const sequence = ++searchSequence.current;

    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchAttempted(false);
      return;
    }

    setSearching(true);
    setSearchAttempted(false);
    setNotice('');

    const timer = window.setTimeout(() => {
      void searchPlatformUsers(term)
        .then(users => {
          if (sequence !== searchSequence.current) return;
          setResults(users);
          setSearchAttempted(true);
        })
        .catch(error => {
          if (sequence !== searchSequence.current) return;
          setResults([]);
          setSearchAttempted(true);
          setNotice(error instanceof Error ? error.message : 'Search failed.');
        })
        .finally(() => {
          if (sequence === searchSequence.current) setSearching(false);
        });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [query]);

  const openConversation = async (userId: string) => {
    setSelectedId(userId);
    setNotice('');
    try { setMessages(await getDirectConversation(userId)); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not load the conversation.'); }
  };

  const selectConversation = (userId: string) => {
    setNotice('');
    if (onOpenConversation) {
      setSelectedId(null);
      onOpenConversation(userId);
      return;
    }
    void openConversation(userId);
  };

  const addFriend = async (userId: string) => {
    try {
      await sendPlatformFriendRequest(userId);
      setResults(current => current.filter(user => user.id !== userId));
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not send friend request.');
    }
  };

  const respondFriend = async (requestId: string, accept: boolean) => {
    try { await respondPlatformFriendRequest(requestId, accept); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not respond to the request.'); }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    try {
      const sent = await sendPlatformDirectMessage(selected.id, draft.trim());
      setMessages(previous => previous.some(item => item.id === sent.id) ? previous : [...previous, sent]);
      setDraft('');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not send the message.'); }
  };

  return <aside className="platform-social-rail">
    <header className="platform-social-rail-head">
      <div className="platform-social-head-main">
        <span className="platform-social-head-icon"><Users /></span>
        <span className="platform-social-head-copy"><small>SOCIAL</small><strong>FRIENDS</strong></span>
      </div>
      <div className="platform-social-head-summary" aria-label={`${availableFriendCount} of ${snapshot.friends.length} friends online`}>
        <strong>{availableFriendCount}<span>/{snapshot.friends.length}</span></strong>
        <small>ONLINE</small>
        <i className="platform-social-live-dot" />
      </div>
    </header>

    <form className={`platform-social-search${query.trim().length >= 2 ? ' has-query' : ''}`} onSubmit={event => event.preventDefault()}>
      <Search />
      <input
        aria-label="Search player"
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="Search players…"
        autoComplete="off"
        spellCheck={false}
      />
      <button type="button" aria-label="Clear search" title="Clear search" disabled={!query} onClick={() => { setQuery(''); setResults([]); }}><X /></button>
    </form>

    {query.trim().length >= 2 && <div className="platform-social-search-results" aria-live="polite">
      {searching && <p className="platform-social-search-state"><Search /><span>Searching players…</span></p>}
      {!searching && searchAttempted && results.length === 0 && <p className="platform-social-search-state is-empty"><span>No players found for “{query.trim()}”.</span></p>}
      {!searching && results.map(user => {
        const isFriend = friendIds.has(user.id);
        const outgoing = outgoingIds.has(user.id);
        const incoming = incomingIds.has(user.id);
        const isOnline = onlineIds.has(user.id);
        return <div className="platform-social-search-result" key={user.id}>
          <span className="platform-social-avatar">{user.username.slice(0, 2).toUpperCase()}</span>
          <span className="platform-social-search-copy"><strong>{user.username}</strong><small className={isOnline ? 'is-online' : 'is-offline'}><i />{isOnline ? 'Online' : 'Offline'}</small></span>
          {isFriend
            ? <button className="is-message" type="button" onClick={() => { selectConversation(user.id); setQuery(''); setResults([]); }}>MESSAGE</button>
            : outgoing
              ? <button className="is-pending" type="button" disabled>SENT</button>
              : incoming
                ? <button className="is-pending" type="button" disabled>REQUEST</button>
                : <button className="is-add" type="button" onClick={() => void addFriend(user.id)}><UserPlus /> ADD</button>}
        </div>;
      })}
    </div>}

    {(party.invites.length > 0 || snapshot.incoming.length > 0) && <section className="platform-social-requests"><h4>INVITES</h4>
      {party.invites.map(invite => <div key={invite.id} className="platform-social-request"><span className="platform-social-avatar is-party"><Users /></span><span><strong>{invite.from?.username ?? 'Player'}</strong><small>Party invite</small></span><button type="button" onClick={() => platformRealtime.send('party.accept', { inviteId: invite.id })}><Check /></button><button type="button" onClick={() => platformRealtime.send('party.decline', { inviteId: invite.id })}><X /></button></div>)}
      {snapshot.incoming.map(request => <div key={request.id} className="platform-social-request"><span className="platform-social-avatar">{request.user?.username.slice(0, 2).toUpperCase() ?? 'DR'}</span><span><strong>{request.user?.username ?? 'Player'}</strong><small>Friend request</small></span><button type="button" onClick={() => void respondFriend(request.id, true)}><Check /></button><button type="button" onClick={() => void respondFriend(request.id, false)}><X /></button></div>)}
    </section>}

    <section className="platform-social-friends"><h4>FRIENDS · {snapshot.friends.length}</h4><div>{snapshot.friends.map(friend => {
      const isActive = selectedId === friend.id || activeConversationId === friend.id;
      const presence = resolveFriendPresence(friend, onlineIds);
      return <button type="button" key={friend.id} className={isActive ? 'is-selected' : ''} onClick={() => selectConversation(friend.id)}><span className="platform-social-avatar">{friend.username.slice(0, 2).toUpperCase()}</span><span><strong>{friend.username}</strong><small className={`platform-social-status is-${presence.status}`}>{presence.label}</small></span><i className={`is-${presence.status}`} />{friend.unread > 0 && <em>{friend.unread}</em>}</button>;
    })}{snapshot.friends.length === 0 && <p className="platform-social-empty">Search for players to start your friends list.</p>}</div></section>

    {snapshot.outgoing.length > 0 && <section className="platform-social-pending"><h4>PENDING</h4>{snapshot.outgoing.map(request => <p key={request.id}>{request.user?.username ?? 'Player'}</p>)}</section>}

    {notice && <p className="platform-social-notice">{notice}</p>}

    {selected && (() => {
      const presence = resolveFriendPresence(selected, onlineIds);
      return <section className="platform-social-drawer" aria-label={`Conversation with ${selected.username}`}>
        <header><div><span className="platform-social-avatar">{selected.username.slice(0, 2).toUpperCase()}</span><span><strong>{selected.username}</strong><small className={`platform-social-status is-${presence.status}`}>{presence.label}</small></span></div><button type="button" onClick={() => setSelectedId(null)}><X /></button></header>
        <div className="platform-social-messages">{messages.length === 0 && <p>No messages yet.</p>}{messages.map(message => <div key={message.id} className={message.fromUserId === me.id ? 'is-mine' : ''}><span>{message.text}</span><small>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>)}</div>
        <form onSubmit={sendMessage}><MessageCircle /><input value={draft} onChange={event => setDraft(event.target.value)} maxLength={500} placeholder={`Message ${selected.username}`} /><button>Send</button></form>
      </section>;
    })()}
  </aside>;
}
