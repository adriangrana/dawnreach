import { MessageSquare, SendHorizontal, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  getDirectConversation,
  platformRealtime,
  sendPlatformDirectMessage,
  type DirectMessage,
  type PartyMessage,
  type PartySnapshot,
  type PlatformRealtimeEvent,
  type PlatformUser,
  type SocialSnapshot,
} from './index';
import { resolveFriendPresence } from './presence';

function eventType(event: PlatformRealtimeEvent) {
  return typeof event === 'object' && event !== null && 'type' in event ? String(event.type || '') : '';
}

function directChannel(userId: string) {
  return `direct:${userId}`;
}

function directIdFromChannel(channel: string | null) {
  return channel?.startsWith('direct:') ? channel.slice('direct:'.length) : null;
}

export function HomeChatPanel({
  me,
  online,
  snapshot,
  party,
  selectedFriendId,
  refreshSocial,
  onActiveDirectChange,
}: {
  me: PlatformUser;
  online: readonly PlatformUser[];
  snapshot: SocialSnapshot;
  party: PartySnapshot;
  selectedFriendId: string | null;
  refreshSocial: () => Promise<void>;
  onActiveDirectChange?: (userId: string | null) => void;
}) {
  const [openDirectIds, setOpenDirectIds] = useState<string[]>([]);
  const [activeChannel, setActiveChannel] = useState<string>('party');
  const [directMessages, setDirectMessages] = useState<Record<string, readonly DirectMessage[]>>({});
  const [partyMessages, setPartyMessages] = useState<readonly PartyMessage[]>(party.messages ?? []);
  const [draft, setDraft] = useState('');
  const [loadingDirectId, setLoadingDirectId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const friendsById = useMemo(() => new Map(snapshot.friends.map(friend => [friend.id, friend])), [snapshot.friends]);
  const onlineIds = useMemo(() => new Set(online.map(user => user.id)), [online]);
  const activeDirectId = directIdFromChannel(activeChannel);
  const selected = activeDirectId ? friendsById.get(activeDirectId) ?? null : null;
  const selectedPresence = useMemo(
    () => selected ? resolveFriendPresence(selected, onlineIds) : null,
    [selected, onlineIds],
  );
  const activeDirectMessages = activeDirectId ? directMessages[activeDirectId] ?? [] : [];
  const loading = Boolean(activeDirectId && loadingDirectId === activeDirectId);
  const partyActive = activeChannel === 'party';

  const activateParty = () => {
    setActiveChannel('party');
    setDraft('');
    setNotice('');
    onActiveDirectChange?.(null);
  };

  const activateDirect = (userId: string) => {
    if (!friendsById.has(userId)) return;
    setOpenDirectIds(current => current.includes(userId) ? current : [...current, userId]);
    setActiveChannel(directChannel(userId));
    setDraft('');
    setNotice('');
    onActiveDirectChange?.(userId);
  };

  const closeDirect = (userId: string) => {
    const remaining = openDirectIds.filter(id => id !== userId && friendsById.has(id));
    setOpenDirectIds(remaining);
    setDirectMessages(current => {
      const next = { ...current };
      delete next[userId];
      return next;
    });
    if (activeDirectId !== userId) return;
    const fallbackId = remaining.at(-1) ?? null;
    if (fallbackId) activateDirect(fallbackId);
    else activateParty();
  };

  useEffect(() => {
    if (!selectedFriendId || !friendsById.has(selectedFriendId)) return;
    setOpenDirectIds(current => current.includes(selectedFriendId) ? current : [...current, selectedFriendId]);
    setActiveChannel(directChannel(selectedFriendId));
    setDraft('');
    setNotice('');
  }, [selectedFriendId, friendsById]);

  useEffect(() => {
    setOpenDirectIds(current => current.filter(id => friendsById.has(id)));
    if (activeDirectId && !friendsById.has(activeDirectId)) activateParty();
  }, [activeDirectId, friendsById]);

  useEffect(() => {
    setPartyMessages(party.messages ?? []);
  }, [party.party?.id, party.messages]);

  useEffect(() => {
    if (!activeDirectId) return;
    let active = true;
    setLoadingDirectId(activeDirectId);
    setNotice('');
    void getDirectConversation(activeDirectId)
      .then(next => {
        if (!active) return;
        setDirectMessages(current => ({ ...current, [activeDirectId]: next }));
        void refreshSocial().catch(() => undefined);
      })
      .catch(error => {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : 'Could not load the conversation.');
      })
      .finally(() => {
        if (active) setLoadingDirectId(current => current === activeDirectId ? null : current);
      });
    return () => { active = false; };
  }, [activeDirectId, refreshSocial]);

  useEffect(() => platformRealtime.subscribe(event => {
    const type = eventType(event);
    if (type === 'direct.message' && 'message' in event) {
      const incoming = event.message as DirectMessage;
      const otherUserId = incoming.fromUserId === me.id ? incoming.toUserId : incoming.fromUserId;
      if (!friendsById.has(otherUserId)) return;
      setOpenDirectIds(current => current.includes(otherUserId) ? current : [...current, otherUserId]);
      setDirectMessages(current => {
        const previous = current[otherUserId] ?? [];
        return previous.some(item => item.id === incoming.id)
          ? current
          : { ...current, [otherUserId]: [...previous, incoming] };
      });
      if (incoming.fromUserId === activeDirectId) {
        void getDirectConversation(activeDirectId)
          .then(next => setDirectMessages(current => ({ ...current, [activeDirectId]: next })))
          .then(() => refreshSocial())
          .catch(() => undefined);
      }
      return;
    }
    if (type === 'party.message' && 'message' in event) {
      const incoming = event.message as PartyMessage;
      if (party.party && incoming.partyId !== party.party.id) return;
      setPartyMessages(current => current.some(item => item.id === incoming.id) ? current : [...current, incoming]);
    }
  }), [activeDirectId, friendsById, me.id, party.party?.id, refreshSocial]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [activeChannel, activeDirectMessages, partyMessages, loading]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setNotice('');
    try {
      if (partyActive) {
        if (!platformRealtime.send('party.message', { text })) throw new Error('Realtime connection unavailable.');
        setDraft('');
        return;
      }
      if (!selected) return;
      const sent = await sendPlatformDirectMessage(selected.id, text);
      setDirectMessages(current => {
        const previous = current[selected.id] ?? [];
        return previous.some(item => item.id === sent.id)
          ? current
          : { ...current, [selected.id]: [...previous, sent] };
      });
      setDraft('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not send the message.');
    } finally {
      setSending(false);
    }
  };

  const canCompose = partyActive ? true : Boolean(selected) && !loading;
  const ariaLabel = partyActive ? 'Party chat' : selected ? `Chat with ${selected.username}` : 'Chat';
  const partyMemberCount = party.party?.members.length ?? 1;

  return <article
    className={`dr-home-channel-card dr-home-chat-card${activeChannel ? ' is-active' : ''}`}
    tabIndex={0}
    aria-label={ariaLabel}
    onMouseDown={event => {
      const target = event.target as HTMLElement;
      if (target.closest('input, button')) return;
      event.currentTarget.focus({ preventScroll: true });
    }}
  >
    <header className="dr-home-chat-head">
      <div className="dr-home-chat-tabs" role="tablist" aria-label="Chat channels">
        <strong className="dr-home-chat-title">CHAT</strong>
        <button
          type="button"
          role="tab"
          className={`dr-home-chat-tab is-party${partyActive ? ' is-active' : ''}`}
          aria-selected={partyActive}
          onClick={activateParty}
          title="Party channel"
        >
          <Users />
          <span>PARTY</span>
          <em>{partyMemberCount}/5</em>
        </button>
        {openDirectIds.map(userId => {
          const friend = friendsById.get(userId);
          if (!friend) return null;
          const active = activeDirectId === userId;
          return <span key={userId} className={`dr-home-chat-direct-tab${active ? ' is-active' : ''}`}>
            <button type="button" role="tab" aria-selected={active} onClick={() => activateDirect(userId)}>
              <span>{friend.username}</span>
              {friend.unread > 0 && !active && <em>{friend.unread}</em>}
            </button>
            <button type="button" className="dr-home-chat-tab-close" aria-label={`Close ${friend.username} chat`} onClick={() => closeDirect(userId)}><X /></button>
          </span>;
        })}
      </div>

      {partyActive
        ? <div className="dr-home-chat-party-meta"><Users /><span><strong>PARTY</strong><small>{partyMemberCount} {partyMemberCount === 1 ? 'member' : 'members'}</small></span></div>
        : selected && selectedPresence
          ? <div className="dr-home-chat-peer"><span className="dr-home-chat-avatar">{selected.username.slice(0, 2).toUpperCase()}</span><span><strong>{selected.username}</strong><small className={`dr-home-chat-status is-${selectedPresence.status}`}><i className={`is-${selectedPresence.status}`} />{selectedPresence.label}</small></span></div>
          : <span className="dr-home-chat-hint">Open a friend</span>}
    </header>

    <div className="dr-home-chat-messages" ref={scrollRef} aria-live="polite">
      {partyActive && partyMessages.length === 0 && <div className="dr-home-chat-empty"><Users /><span><strong>Party channel ready</strong><small>Invite players from the party panel. Messages here are shared with your current group.</small></span></div>}
      {partyActive && partyMessages.map(message => <div key={message.id} className={`dr-home-chat-message is-party${message.fromUserId === me.id ? ' is-mine' : ''}`}>
        <span className="dr-home-chat-message-copy"><b>{message.fromUserId === me.id ? 'You' : message.username}</b><span>{message.text}</span></span>
        <small>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
      </div>)}

      {!partyActive && selected && loading && <div className="dr-home-chat-empty is-loading"><span><strong>Loading conversation…</strong></span></div>}
      {!partyActive && selected && !loading && activeDirectMessages.length === 0 && <div className="dr-home-chat-empty"><MessageSquare /><span><strong>No messages yet</strong><small>Send the first message to {selected.username}.</small></span></div>}
      {!partyActive && selected && !loading && activeDirectMessages.map(message => <div key={message.id} className={`dr-home-chat-message${message.fromUserId === me.id ? ' is-mine' : ''}`}>
        <span>{message.text}</span>
        <small>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
      </div>)}

      {notice && <p className="dr-home-chat-notice" role="status">{notice}</p>}
    </div>

    <form className="dr-home-chat-compose" onSubmit={sendMessage}>
      <input
        aria-label={partyActive ? 'Message party' : selected ? `Message ${selected.username}` : 'Select a chat channel'}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        maxLength={500}
        disabled={!canCompose}
        placeholder={partyActive ? 'Message party…' : selected ? `Message ${selected.username}…` : 'Open a direct chat…'}
      />
      <button type="submit" disabled={!canCompose || !draft.trim() || sending} aria-label="Send message" title="Send message">
        <SendHorizontal />
      </button>
    </form>
  </article>;
}
