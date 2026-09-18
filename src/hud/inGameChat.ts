import {
  MAX_CHAT_MESSAGE_LENGTH,
  normalizeChatText,
  publishInGameChatMessage,
  subscribeInGameChat,
  type InGameChatChannel,
  type InGameChatMessage,
} from '../game/match/chat';
import { platformRealtime } from '../platform/realtimeClient';
import type { PlatformRealtimeEvent } from '../platform/types';

const CHAT_ROOT_ID = 'dawnreach-in-game-chat';
const CHAT_INPUT_ID = 'dawnreach-in-game-chat-input';
const LOCAL_PLAYER_ID = 'local-player';
const LOCAL_TEAM = 'blue' as const;

export type InGameChatRuntimeOptions = Readonly<{
  matchId?: string | null;
  playerId?: string | null;
  playerName?: string | null;
  team?: InGameChatMessage['team'] | null;
}>;

const MAX_RENDERED_MESSAGES = 40;
const COLLAPSED_VISIBLE_MESSAGES = 6;
const MINIMAP_GAP_PX = 12;
const VIEWPORT_EDGE_PX = 10;

let localMessageSequence = 0;

function isTypingTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

function channelLabel(channel: InGameChatChannel) {
  return channel === 'team' ? 'EQUIPO' : 'TODOS';
}

function teamClass(team: InGameChatMessage['team']) {
  return team === 'blue' ? 'is-dawn' : 'is-dusk';
}

function playerLabel(message: InGameChatMessage, localPlayerId: string) {
  if (message.playerId === localPlayerId) return 'Tú';
  return message.playerName?.trim() || message.playerId;
}

function createMessageRow(message: InGameChatMessage, localPlayerId: string) {
  const row = document.createElement('div');
  row.className = `in-game-chat-message ${teamClass(message.team)} channel-${message.channel}`;
  row.dataset.messageId = message.messageId;

  const channel = document.createElement('span');
  channel.className = 'in-game-chat-message-channel';
  channel.textContent = message.channel === 'team' ? '[Equipo]' : '[Todos]';

  const player = document.createElement('strong');
  player.className = 'in-game-chat-message-player';
  player.textContent = `${playerLabel(message, localPlayerId)}:`;

  const text = document.createElement('span');
  text.className = 'in-game-chat-message-text';
  text.textContent = message.text;

  row.append(channel, player, text);
  return row;
}

function nextMessageId() {
  localMessageSequence += 1;
  return `local:${Date.now()}:${localMessageSequence}`;
}

export function mountInGameChat(options: InGameChatRuntimeOptions = {}) {
  if (typeof document === 'undefined') return () => undefined;
  document.getElementById(CHAT_ROOT_ID)?.remove();

  const matchId = options.matchId?.trim() || null;
  const localPlayerId = options.playerId?.trim() || LOCAL_PLAYER_ID;
  const localPlayerName = options.playerName?.trim() || undefined;
  const localTeam = options.team === 'red' ? 'red' : LOCAL_TEAM;
  const networked = Boolean(matchId && options.playerId);

  const root = document.createElement('aside');
  root.id = CHAT_ROOT_ID;
  root.className = 'in-game-chat';
  root.setAttribute('aria-label', 'Chat de partida');

  const history = document.createElement('div');
  history.className = 'in-game-chat-history';
  history.setAttribute('aria-live', 'polite');
  history.setAttribute('aria-relevant', 'additions');

  const composer = document.createElement('div');
  composer.className = 'in-game-chat-composer';
  composer.hidden = true;

  const channelBadge = document.createElement('span');
  channelBadge.className = 'in-game-chat-channel-badge is-team';
  channelBadge.textContent = 'EQUIPO';

  const input = document.createElement('input');
  input.id = CHAT_INPUT_ID;
  input.className = 'in-game-chat-input';
  input.type = 'text';
  input.maxLength = MAX_CHAT_MESSAGE_LENGTH;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Escribe un mensaje…';
  input.setAttribute('aria-label', 'Mensaje de chat');

  const hint = document.createElement('span');
  hint.className = 'in-game-chat-hint';
  hint.textContent = 'Enter enviar · Esc cerrar';

  composer.append(channelBadge, input, hint);
  root.append(history, composer);
  document.body.appendChild(root);

  let activeChannel: InGameChatChannel = 'team';
  let open = false;
  let minimapShell: HTMLElement | null = null;

  const syncPlacement = () => {
    minimapShell = document.querySelector<HTMLElement>('.minimap-shell');
    if (!minimapShell) {
      root.style.removeProperty('bottom');
      root.style.removeProperty('left');
      root.style.removeProperty('right');
      return;
    }

    const rect = minimapShell.getBoundingClientRect();
    const bottom = Math.max(
      VIEWPORT_EDGE_PX,
      window.innerHeight - rect.top + MINIMAP_GAP_PX,
    );
    root.style.bottom = `${Math.round(bottom)}px`;

    const minimapOnLeft = rect.left + rect.width / 2 <= window.innerWidth / 2;
    if (minimapOnLeft) {
      root.style.left = `${Math.max(VIEWPORT_EDGE_PX, Math.round(rect.left))}px`;
      root.style.right = 'auto';
    } else {
      root.style.right = `${Math.max(VIEWPORT_EDGE_PX, Math.round(window.innerWidth - rect.right))}px`;
      root.style.left = 'auto';
    }
  };

  const syncOpenState = () => {
    composer.hidden = !open;
    root.classList.toggle('is-open', open);
    history.classList.toggle('is-expanded', open);
    document.body.dataset.dawnreachChatOpen = open ? 'true' : 'false';
    syncPlacement();
  };

  const setChannel = (channel: InGameChatChannel) => {
    activeChannel = channel;
    channelBadge.textContent = channelLabel(channel);
    channelBadge.classList.toggle('is-team', channel === 'team');
    channelBadge.classList.toggle('is-all', channel === 'all');
    input.placeholder = channel === 'team'
      ? 'Mensaje para tu equipo…'
      : 'Mensaje para todos…';
  };

  const openChat = (channel: InGameChatChannel) => {
    setChannel(channel);
    open = true;
    syncOpenState();
    requestAnimationFrame(() => {
      syncPlacement();
      input.focus({ preventScroll: true });
      input.select();
    });
  };

  const closeChat = () => {
    open = false;
    input.value = '';
    input.blur();
    syncOpenState();
  };

  const submit = () => {
    const text = normalizeChatText(input.value);
    if (text) {
      const sent = networked && matchId
        ? platformRealtime.send('match.chat.send', {
          matchId,
          channel: activeChannel,
          text,
        })
        : false;

      // Online messages are rendered from the authoritative server echo so the sender and
      // recipients see the same id/order. Offline development matches keep the local bus.
      if (!sent) {
        publishInGameChatMessage({
          messageId: nextMessageId(),
          playerId: localPlayerId,
          playerName: localPlayerName,
          team: localTeam,
          channel: activeChannel,
          text,
          atMs: performance.now(),
        });
      }
    }
    closeChat();
  };

  const appendMessage = (message: InGameChatMessage) => {
    if (history.querySelector(`[data-message-id="${CSS.escape(message.messageId)}"]`)) return;
    history.appendChild(createMessageRow(message, localPlayerId));
    while (history.children.length > MAX_RENDERED_MESSAGES) history.firstElementChild?.remove();
    const rows = Array.from(history.children) as HTMLElement[];
    for (const [index, row] of rows.entries()) {
      row.classList.toggle('is-collapsed-hidden', !open && index < rows.length - COLLAPSED_VISIBLE_MESSAGES);
    }
    history.scrollTop = history.scrollHeight;
  };

  const refreshCollapsedRows = () => {
    const rows = Array.from(history.children) as HTMLElement[];
    for (const [index, row] of rows.entries()) {
      row.classList.toggle('is-collapsed-hidden', !open && index < rows.length - COLLAPSED_VISIBLE_MESSAGES);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;

    if (!open) {
      if (event.code !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey || isTypingTarget(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openChat(event.shiftKey ? 'all' : 'team');
      return;
    }

    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeChat();
      refreshCollapsedRows();
      return;
    }

    if (event.code === 'Enter' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      submit();
      refreshCollapsedRows();
      return;
    }

    // Keep the browser's default text-editing action, but do not let gameplay/global shortcuts
    // observe the keystroke while the chat textbox owns focus.
    event.stopImmediatePropagation();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!open || root.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeChat();
    refreshCollapsedRows();
  };

  const onContextMenu = (event: MouseEvent) => {
    if (!open || root.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const unsubscribe = subscribeInGameChat((message) => {
    appendMessage(message);
    refreshCollapsedRows();
  });

  const unsubscribeRealtime = networked && matchId
    ? platformRealtime.subscribe((event: PlatformRealtimeEvent) => {
      if (
        typeof event !== 'object'
        || event === null
        || !('type' in event)
        || event.type !== 'match.chat.message'
        || !('message' in event)
        || !event.message
      ) return;

      const raw = event.message as {
        messageId?: unknown;
        matchId?: unknown;
        playerId?: unknown;
        playerName?: unknown;
        team?: unknown;
        channel?: unknown;
        text?: unknown;
        atMs?: unknown;
      };
      if (String(raw.matchId || '') !== matchId) return;

      publishInGameChatMessage({
        messageId: String(raw.messageId || ''),
        playerId: String(raw.playerId || ''),
        playerName: String(raw.playerName || '').trim() || undefined,
        team: raw.team === 'red' ? 'red' : 'blue',
        channel: raw.channel === 'team' ? 'team' : 'all',
        text: normalizeChatText(String(raw.text || '')),
        atMs: Number(raw.atMs || Date.now()),
      });
    })
    : () => undefined;

  const resizeObserver = new ResizeObserver(syncPlacement);
  const observeMinimap = () => {
    const current = document.querySelector<HTMLElement>('.minimap-shell');
    if (current && current !== minimapShell) {
      if (minimapShell) resizeObserver.unobserve(minimapShell);
      minimapShell = current;
      resizeObserver.observe(current);
    }
    syncPlacement();
  };
  observeMinimap();

  const layoutObserver = new MutationObserver(observeMinimap);
  layoutObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
  layoutObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  });

  window.addEventListener('resize', syncPlacement, { passive: true });
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  syncOpenState();
  requestAnimationFrame(syncPlacement);

  return () => {
    unsubscribeRealtime();
    unsubscribe();
    resizeObserver.disconnect();
    layoutObserver.disconnect();
    window.removeEventListener('resize', syncPlacement);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('contextmenu', onContextMenu, true);
    delete document.body.dataset.dawnreachChatOpen;
    root.remove();
  };
}
