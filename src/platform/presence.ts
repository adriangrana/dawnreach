import type { FriendPresenceStatus, PlatformFriend } from './types';

export const FRIEND_PRESENCE_LABELS: Readonly<Record<FriendPresenceStatus, string>> = {
  in_match: 'In Match',
  in_queue: 'In Queue',
  online: 'Online',
  away: 'Away',
  offline: 'Offline',
};

export const FRIEND_PRESENCE_PRIORITY: Readonly<Record<FriendPresenceStatus, number>> = {
  in_match: 5,
  in_queue: 4,
  online: 3,
  away: 2,
  offline: 1,
};

export function resolveFriendPresence(friend: PlatformFriend, onlineIds?: ReadonlySet<string>) {
  const known = friend.status in FRIEND_PRESENCE_LABELS
    ? friend.status
    : onlineIds?.has(friend.id)
      ? 'online'
      : 'offline';

  return {
    status: known as FriendPresenceStatus,
    label: FRIEND_PRESENCE_LABELS[known as FriendPresenceStatus],
  } as const;
}
