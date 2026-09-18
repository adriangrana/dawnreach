export type InGameChatChannel = 'team' | 'all';
export type InGameChatTeam = 'blue' | 'red';

export const MAX_CHAT_MESSAGE_LENGTH = 220;

export type InGameChatMessage = Readonly<{
  messageId: string;
  playerId: string;
  playerName?: string;
  team: InGameChatTeam;
  channel: InGameChatChannel;
  text: string;
  atMs: number;
}>;

type ChatListener = (message: InGameChatMessage) => void;

export class InGameChatBus {
  private readonly listeners = new Set<ChatListener>();

  subscribe(listener: ChatListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(message: InGameChatMessage): void {
    for (const listener of [...this.listeners]) listener(message);
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

const chatBus = new InGameChatBus();

export function normalizeChatText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, MAX_CHAT_MESSAGE_LENGTH);
}

export function isValidInGameChatMessage(message: InGameChatMessage): boolean {
  if (!message.messageId.trim() || !message.playerId.trim()) return false;
  if (message.playerName !== undefined && (!message.playerName.trim() || message.playerName.length > 64)) return false;
  if (message.team !== 'blue' && message.team !== 'red') return false;
  if (message.channel !== 'team' && message.channel !== 'all') return false;
  if (!Number.isFinite(message.atMs) || message.atMs < 0) return false;
  const normalized = normalizeChatText(message.text);
  return normalized.length > 0 && normalized === message.text;
}

export function subscribeInGameChat(listener: ChatListener): () => void {
  return chatBus.subscribe(listener);
}

export function publishInGameChatMessage(message: InGameChatMessage): boolean {
  if (!isValidInGameChatMessage(message)) return false;
  chatBus.publish(message);
  return true;
}
