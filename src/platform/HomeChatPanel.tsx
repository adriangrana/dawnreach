import { MessageSquare, SendHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  getDirectConversation,
  platformRealtime,
  sendPlatformDirectMessage,
  type DirectMessage,
  type PlatformRealtimeEvent,
  type PlatformUser,
  type SocialSnapshot,
} from './index';

function eventType(event: PlatformRealtimeEvent) {
  return typeof event === 'object' && event !== null && 'type' in event ? String(event.type || '') : '';
}

export function HomeChatPanel({
  me,
  online,
  snapshot,
  selectedFriendId,
  refreshSocial,
}: {
  me: PlatformUser;
  online: readonly PlatformUser[];
  snapshot: SocialSnapshot;
  selectedFriendId: string | null;
  refreshSocial: () => Promise<void>;
}) {
  const [messages, setMessages] = useState<readonly DirectMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const selected = useMemo(
    () => snapshot.friends.find(friend => friend.id === selectedFriendId) ?? null,
    [snapshot.friends, selectedFriendId],
  );
  const onlineIds = useMemo(() => new Set(online.map(user => user.id)), [online]);
  const isSelectedOnline = Boolean(selected && onlineIds.has(selected.id));

  useEffect(() => {
    if (!selectedFriendId) {
      setMessages([]);
      setDraft('');
      setNotice('');
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setNotice('');
    void getDirectConversation(selectedFriendId)
      .then(next => {
        if (!active) return;
        setMessages(next);
        void refreshSocial().catch(() => undefined);
      })
      .catch(error => {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : 'Could not load the conversation.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [selectedFriendId, refreshSocial]);

  useEffect(() => platformRealtime.subscribe(event => {
    if (eventType(event) !== 'direct.message' || !('message' in event)) return;
    const incoming = event.message as DirectMessage;
    if (!selectedFriendId || (incoming.fromUserId !== selectedFriendId && incoming.toUserId !== selectedFriendId)) return;
    setMessages(previous => previous.some(item => item.id === incoming.id) ? previous : [...previous, incoming]);
    if (incoming.fromUserId === selectedFriendId) void refreshSocial().catch(() => undefined);
  }), [selectedFriendId, refreshSocial]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, loading]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!selected || !text || sending) return;
    setSending(true);
    setNotice('');
    try {
      const sent = await sendPlatformDirectMessage(selected.id, text);
      setMessages(previous => previous.some(item => item.id === sent.id) ? previous : [...previous, sent]);
      setDraft('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not send the message.');
    } finally {
      setSending(false);
    }
  };

  return <article className={`dr-home-channel-card dr-home-chat-card${selected ? ' is-active' : ''}`}>
    <header className="dr-home-chat-head">
      <div className="dr-home-chat-channel"><strong>CHAT</strong><span>Direct</span></div>
      {selected
        ? <div className="dr-home-chat-peer"><span className="dr-home-chat-avatar">{selected.username.slice(0, 2).toUpperCase()}</span><span><strong>{selected.username}</strong><small><i className={isSelectedOnline ? 'is-online' : ''} />{isSelectedOnline ? 'Online' : 'Offline'}</small></span></div>
        : <span className="dr-home-chat-hint">Select a friend</span>}
    </header>

    <div className="dr-home-chat-messages" ref={scrollRef} aria-live="polite">
      {!selected && <div className="dr-home-chat-empty"><MessageSquare /><span><strong>Start a conversation</strong><small>Select a friend from the right panel.</small></span></div>}
      {selected && loading && <div className="dr-home-chat-empty is-loading"><span><strong>Loading conversation…</strong></span></div>}
      {selected && !loading && messages.length === 0 && <div className="dr-home-chat-empty"><MessageSquare /><span><strong>No messages yet</strong><small>Send the first message to {selected.username}.</small></span></div>}
      {!loading && messages.map(message => <div key={message.id} className={`dr-home-chat-message${message.fromUserId === me.id ? ' is-mine' : ''}`}>
        <span>{message.text}</span>
        <small>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
      </div>)}
      {notice && <p className="dr-home-chat-notice" role="status">{notice}</p>}
    </div>

    <form className="dr-home-chat-compose" onSubmit={sendMessage}>
      <input
        aria-label={selected ? `Message ${selected.username}` : 'Select a friend to start a conversation'}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        maxLength={500}
        disabled={!selected || loading}
        placeholder={selected ? `Message ${selected.username}…` : 'Select a friend to start a conversation…'}
      />
      <button type="submit" disabled={!selected || !draft.trim() || loading || sending} aria-label="Send message" title="Send message">
        <SendHorizontal />
      </button>
    </form>
  </article>;
}
