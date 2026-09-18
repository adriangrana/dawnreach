export type QueueMode = 'ranked' | 'normal';
export type Team = 'blue' | 'red';
export type FriendPresenceStatus = 'in_match' | 'in_queue' | 'online' | 'away' | 'offline';

export type PlatformUser = Readonly<{
  id: string;
  username: string;
  createdAt: string;
  rating: number;
  wins: number;
  losses: number;
  calibrated: boolean;
  calibrationGames: number;
  calibrationTarget: number;
  rankedGames: number;
}>;

export type PlatformSession = Readonly<{
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  label: string;
  current: boolean;
}>;

export type AuthResponse = Readonly<{ token: string; user: PlatformUser }>;

export type PlatformFriend = PlatformUser & Readonly<{ status: FriendPresenceStatus; unread: number }>;

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

export type PartyMessage = Readonly<{
  id: string;
  partyId: string;
  fromUserId: string;
  username: string;
  text: string;
  createdAt: string;
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
  messages: readonly PartyMessage[];
}>;

export type QueuePlayer = Readonly<{
  userId: string;
  username: string;
  rating: number;
  joinedAt: number;
  partyId?: string;
}>;

export type QueueState = Readonly<{ joined: boolean; mode: QueueMode; count: number; target: number }>;

export type ReadyState = Readonly<{
  readyId: string;
  mode: QueueMode;
  players: readonly QueuePlayer[];
  expiresAt: number;
  acceptedUserIds: readonly string[];
  declinedUserIds: readonly string[];
}>;

export type MatchPlayer = QueuePlayer & Readonly<{ team: Team; slot: number }>;

export type MatchSummary = Readonly<{
  id: string;
  mode: QueueMode | 'custom';
  source: 'matchmaking' | 'custom';
  lobbyId?: string;
  rated: boolean;
  status: 'launching';
  createdAt: string;
  players: readonly MatchPlayer[];
  mapSha256: string | null;
}>;

export type LobbyPlayer = Readonly<{
  userId: string;
  username: string;
  rating: number;
  joinedAt: number;
  team: Team;
  slot: number;
  ready: boolean;
}>;

export type LobbyMessage = Readonly<{
  id: string;
  lobbyId: string;
  fromUserId: string | null;
  username: string;
  channel: 'system' | 'all' | 'team';
  team: Team | null;
  text: string;
  createdAt: string;
}>;

export type CustomLobby = Readonly<{
  id: string;
  code: string;
  name: string;
  ownerId: string;
  ownerUsername: string;
  privacy: 'public' | 'private';
  maxPlayers: number;
  status: 'open' | 'launching' | 'in_game';
  createdAt: string;
  players: readonly LobbyPlayer[];
  messages: readonly LobbyMessage[];
  matchId?: string;
}>;

export type PresenceSnapshot = Readonly<{ type: 'presence.snapshot'; users: readonly PlatformUser[] }>;
export type SessionReadyEvent = Readonly<{
  type: 'session.ready';
  user: PlatformUser;
  presence: readonly PlatformUser[];
  social?: SocialSnapshot;
  party?: PartySnapshot;
  queue?: Readonly<{ joined: boolean; target: number }>;
  lobbies?: readonly CustomLobby[];
  lobby?: CustomLobby | null;
}>;
export type SocialSnapshotEvent = SocialSnapshot & Readonly<{ type: 'social.snapshot' }>;
export type DirectMessageEvent = Readonly<{ type: 'direct.message'; message: DirectMessage; user: PlatformUser | null }>;
export type PartySnapshotEvent = PartySnapshot & Readonly<{ type: 'party.snapshot' }>;
export type PartyMessageEvent = Readonly<{ type: 'party.message'; message: PartyMessage }>;
export type PartyInviteEvent = Readonly<{ type: 'party.invite'; invite: PlatformPartyInvite }>;
export type QueueUpdateEvent = Readonly<{ type: 'queue.update'; mode: QueueMode; count: number; target: number }>;
export type ReadyStartEvent = Readonly<{ type: 'ready.start'; readyId: string; mode: QueueMode; players: readonly QueuePlayer[]; expiresAt: number }>;
export type ReadyProgressEvent = Readonly<{ type: 'ready.progress'; readyId: string; acceptedUserIds: readonly string[]; declinedUserIds: readonly string[] }>;
export type ReadyCancelledEvent = Readonly<{ type: 'ready.cancelled'; readyId: string; declinedUserId: string | null }>;
export type MatchFoundEvent = Readonly<{ type: 'match.found'; match: MatchSummary }>;
export type LobbiesUpdateEvent = Readonly<{ type: 'lobbies.update'; lobbies: readonly CustomLobby[] }>;
export type LobbyUpdateEvent = Readonly<{ type: 'lobby.update'; lobby: CustomLobby }>;
export type LobbyLeftEvent = Readonly<{ type: 'lobby.left'; lobbyId: string }>;
export type LobbyClosedEvent = Readonly<{ type: 'lobby.closed'; lobbyId: string; matchId?: string }>;

export type PlatformRealtimeEvent =
  | PresenceSnapshot
  | SessionReadyEvent
  | SocialSnapshotEvent
  | DirectMessageEvent
  | PartySnapshotEvent
  | PartyMessageEvent
  | PartyInviteEvent
  | QueueUpdateEvent
  | ReadyStartEvent
  | ReadyProgressEvent
  | ReadyCancelledEvent
  | MatchFoundEvent
  | LobbiesUpdateEvent
  | LobbyUpdateEvent
  | LobbyLeftEvent
  | LobbyClosedEvent
  | Readonly<Record<string, unknown>>;
