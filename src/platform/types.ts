export type PlatformUser = Readonly<{
  id: string;
  username: string;
  createdAt: string;
}>;

export type PlatformSession = Readonly<{
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  label: string;
  current: boolean;
}>;

export type AuthResponse = Readonly<{
  token: string;
  user: PlatformUser;
}>;

export type PlatformFriend = PlatformUser & Readonly<{
  status: 'online' | 'offline';
  unread: number;
}>;

export type PlatformFriendRequest = Readonly<{
  id: string;
  fromUserId: string;
  toUserId: string;
  createdAt: string;
  user: PlatformUser | null;
}>;

export type SocialSnapshot = Readonly<{
  friends: readonly PlatformFriend[];
  incoming: readonly PlatformFriendRequest[];
  outgoing: readonly PlatformFriendRequest[];
}>;

export type DirectMessage = Readonly<{
  id: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  createdAt: string;
  readAt: string | null;
}>;

export type PlatformParty = Readonly<{
  id: string;
  code: string;
  leaderId: string;
  members: readonly PlatformUser[];
  createdAt: string;
}>;

export type PlatformPartyInvite = Readonly<{
  id: string;
  partyId: string;
  fromUserId: string;
  toUserId: string;
  createdAt: string;
  from: PlatformUser | null;
  party?: PlatformParty;
}>;

export type PartySnapshot = Readonly<{
  party: PlatformParty | null;
  invites: readonly PlatformPartyInvite[];
}>;

export type PresenceSnapshot = Readonly<{
  type: 'presence.snapshot';
  users: readonly PlatformUser[];
}>;

export type SessionReadyEvent = Readonly<{
  type: 'session.ready';
  user: PlatformUser;
  presence: readonly PlatformUser[];
  social?: SocialSnapshot;
  party?: PartySnapshot;
}>;

export type SocialSnapshotEvent = SocialSnapshot & Readonly<{ type: 'social.snapshot' }>;
export type DirectMessageEvent = Readonly<{
  type: 'direct.message';
  message: DirectMessage;
  user: PlatformUser | null;
}>;
export type PartySnapshotEvent = PartySnapshot & Readonly<{ type: 'party.snapshot' }>;
export type PartyInviteEvent = Readonly<{
  type: 'party.invite';
  invite: PlatformPartyInvite;
}>;

export type PlatformRealtimeEvent =
  | PresenceSnapshot
  | SessionReadyEvent
  | SocialSnapshotEvent
  | DirectMessageEvent
  | PartySnapshotEvent
  | PartyInviteEvent
  | Readonly<Record<string, unknown>>;
