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
  status: 'launching' | 'loading' | 'in_game' | 'completed' | 'cancelled';
  createdAt: string;
  players: readonly MatchPlayer[];
  mapSha256: string | null;
  customSettings?: LobbySettings;
  heroSelections?: Readonly<Record<string, Readonly<{ heroId: string | null; locked: boolean; lockedAt: number | null }>>>;
  loadingProgress?: Readonly<Record<string, number>>;
  startedAt?: string;
  endedAt?: string;
  endReason?: 'loading_abandonment' | 'team_abandonment' | string;
  winnerTeam?: Team | null;
  abandonedUserIds?: readonly string[];
}>;

export type ActiveMatchSession = Readonly<{
  stage: 'hero_select' | 'loading' | 'in_game';
  match: MatchSummary;
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

export type LobbySpectator = Readonly<{
  userId: string;
  username: string;
  rating: number;
  joinedAt: number;
}>;

export type LobbySettings = Readonly<{
  map: 'dawnreach';
  gameMode: 'classic';
  teamSize: 1 | 2 | 3 | 4 | 5;
  heroSelect: 'all_pick' | 'draft';
  bans: 'none' | '2' | '4';
  allowSpectators: boolean;
  privacy: 'public' | 'private';
  region: 'auto' | 'eu' | 'na' | 'sa';
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
  maxSpectators: number;
  status: 'open' | 'launching' | 'in_game';
  createdAt: string;
  settings: LobbySettings;
  players: readonly LobbyPlayer[];
  spectators: readonly LobbySpectator[];
  messages: readonly LobbyMessage[];
  matchId?: string;
}>;

export type HeroSelectPlayer = MatchPlayer & Readonly<{
  lane: 'NORTH' | 'MID' | 'SOUTH';
  selection: Readonly<{
    heroId: string | null;
    locked: boolean;
    lockedAt: number | null;
  }>;
}>;

export type HeroSelectMessage = Readonly<{
  id: string;
  username: string;
  userId: string | null;
  team: Team;
  text: string;
  createdAt: string;
  system: boolean;
}>;

export type HeroSelectState = Readonly<{
  id: string;
  match: MatchSummary;
  phase: 'pick' | 'complete';
  selectionType: 'all_pick' | 'draft';
  bansPerTeam: number;
  draftRulesDeferred: boolean;
  rosterDevelopmentMode: boolean;
  teamSize: number;
  startedAt: number;
  expiresAt: number;
  availableHeroIds: readonly string[];
  players: readonly HeroSelectPlayer[];
  messages: readonly HeroSelectMessage[];
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
  heroSelect?: HeroSelectState | null;
  activeMatch?: ActiveMatchSession | null;
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
export type MatchSessionPendingEvent = Readonly<{ type: 'match.session.pending'; match: MatchSummary; note?: string; resumed?: boolean }>;
export type MatchRejoinReadyEvent = Readonly<{ type: 'match.rejoin.ready'; activeMatch: ActiveMatchSession }>;
export type MatchLoadingUpdateEvent = Readonly<{ type: 'match.loading.update'; match: MatchSummary }>;
export type MatchStartEvent = Readonly<{ type: 'match.start'; match: MatchSummary }>;
export type MatchAbandonedEvent = Readonly<{ type: 'match.abandoned'; matchId: string; ended: boolean }>;
export type MatchPlayerAbandonedEvent = Readonly<{ type: 'match.player.abandoned'; match: MatchSummary; userId: string; username: string }>;
export type MatchEndedEvent = Readonly<{ type: 'match.ended'; match: MatchSummary; winnerTeam: Team | null; reason: string }>;

export type MatchRuntimeInventoryItem = Readonly<{
  slot: number;
  definitionId: string;
  displayName: string;
  quantity: number;
  cooldownRemainingMs?: number;
}>;

export type MatchRuntimePlayerState = Readonly<{
  userId: string;
  username: string;
  team: Team;
  slot: number;
  heroId: string;
  sequence: number;
  position: Readonly<{ x: number; y: number; z: number }>;
  yaw: number;
  moving: boolean;
  currentHp: number;
  maxHp: number;
  currentResource: number;
  maxResource: number;
  level: number;
  experience?: number;
  alive: boolean;
  respawnRemainingMs?: number;
  respawnDurationMs?: number;
  abilityRanks?: Readonly<{ Q: number; W: number; E: number; R: number }>;
  abilityCooldownRemainingMs?: Readonly<{ Q: number; W: number; E: number; R: number }>;
  kills: number;
  deaths: number;
  assists: number;
  lastHits: number;
  denies: number;
  gold: number;
  inventory: readonly MatchRuntimeInventoryItem[];
  sentAt: number;
}>;
export type MatchRuntimeStateEvent = Readonly<{ type: 'match.runtime.state'; matchId: string; state: MatchRuntimePlayerState }>;
export type MatchRuntimeSnapshotEvent = Readonly<{ type: 'match.runtime.snapshot'; matchId: string; states: readonly MatchRuntimePlayerState[] }>;
export type MatchRuntimeCombatEvent = Readonly<{
  type: 'match.runtime.combat';
  matchId: string;
  sourceUserId: string;
  sourceUsername: string;
  sourceEntityId: string;
  combatId?: string;
  targetUserId: string;
  targetUsername: string;
  reason: 'damage' | 'heal';
  amount: number;
  lethal?: boolean;
  respawnSeconds?: number | null;
  at: number;
}>;

export type MatchRuntimeCreepState = Readonly<{
  id: string;
  team: Team;
  lane: 'top' | 'mid' | 'bot';
  type: 'melee' | 'ranged' | 'flagbearer' | 'siege';
  position: Readonly<{ x: number; y: number; z: number }>;
  yaw: number;
  currentHp: number;
  maxHp: number;
  alive: boolean;
  state: 'ATTACK_MOVE' | 'COMBAT' | 'AGGRO' | 'RETURNING';
  moving: boolean;
  seed: number;
  attackSequence?: number;
}>;

export type MatchRuntimeCreepSnapshotEvent = Readonly<{
  type: 'match.runtime.creeps';
  matchId: string;
  authorityUserId: string;
  sequence: number;
  sentAt: number;
  creeps: readonly MatchRuntimeCreepState[];
}>;

export type MatchRuntimeCreepDamageEvent = Readonly<{
  type: 'match.runtime.creep.damage';
  matchId: string;
  sourceUserId: string;
  creepId: string;
  amount: number;
  at: number;
}>;

export type MatchRuntimeStructureState = Readonly<{
  id: string;
  team: Team;
  kind: 'tower' | 'building';
  currentHp: number;
  maxHp: number;
  alive: boolean;
}>;

export type MatchRuntimeStructureSnapshotEvent = Readonly<{
  type: 'match.runtime.structures';
  matchId: string;
  authorityUserId: string;
  sequence: number;
  sentAt: number;
  structures: readonly MatchRuntimeStructureState[];
}>;

export type MatchRuntimeStructureDamageEvent = Readonly<{
  type: 'match.runtime.structure.damage';
  matchId: string;
  sourceUserId: string;
  structureId: string;
  amount: number;
  at: number;
}>;

export type MatchRuntimeAuthorityEvent = Readonly<{
  type: 'match.runtime.authority';
  matchId: string;
  authorityUserId: string | null;
}>;

export type MatchConnectionGraceEvent = Readonly<{
  type: 'match.connection.grace';
  matchId: string;
  mode: 'team' | 'all' | 'cleared';
  team: Team | null;
  deadlineAt: number | null;
}>;

export type MatchRuntimePauseStateEvent = Readonly<{
  type: 'match.runtime.pause';
  matchId: string;
  paused: boolean;
  pausedByUserId: string | null;
  pausedByUsername?: string | null;
  revision: number;
  changedAt: number;
  accumulatedPauseMs: number;
}>;

export type MatchRuntimeHeroKillEvent = Readonly<{
  type: 'match.runtime.hero.kill';
  matchId: string;
  eventId: string;
  victimUserId: string;
  victimUsername: string;
  victimTeam: Team;
  victimHeroId: string;
  killerUserId: string | null;
  killerUsername: string | null;
  killerTeam: Team | 'neutral';
  killerHeroId: string | null;
  killerEntityId: string | null;
  at: number;
}>;

export type MatchChatMessage = Readonly<{
  messageId: string;
  matchId: string;
  playerId: string;
  playerName: string;
  team: Team;
  channel: 'team' | 'all';
  text: string;
  atMs: number;
}>;

export type MatchChatMessageEvent = Readonly<{
  type: 'match.chat.message';
  message: MatchChatMessage;
}>;
export type HeroSelectStartEvent = Readonly<{ type: 'hero_select.start'; heroSelect: HeroSelectState }>;
export type HeroSelectUpdateEvent = Readonly<{ type: 'hero_select.update'; heroSelect: HeroSelectState }>;
export type HeroSelectCompleteEvent = Readonly<{ type: 'hero_select.complete'; heroSelect: HeroSelectState }>;
export type HeroSelectCancelledEvent = Readonly<{
  type: 'hero_select.cancelled';
  matchId: string;
  cancelledByUserId: string;
  cancelledByUsername: string;
  source: 'matchmaking' | 'custom';
  mode: QueueMode | 'custom';
}>;

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
  | MatchSessionPendingEvent
  | MatchRejoinReadyEvent
  | MatchLoadingUpdateEvent
  | MatchStartEvent
  | MatchAbandonedEvent
  | MatchPlayerAbandonedEvent
  | MatchEndedEvent
  | MatchRuntimeStateEvent
  | MatchRuntimeSnapshotEvent
  | MatchRuntimeCombatEvent
  | MatchRuntimeCreepSnapshotEvent
  | MatchRuntimeCreepDamageEvent
  | MatchRuntimeStructureSnapshotEvent
  | MatchRuntimeStructureDamageEvent
  | MatchRuntimeAuthorityEvent
  | MatchConnectionGraceEvent
  | MatchRuntimePauseStateEvent
  | MatchRuntimeHeroKillEvent
  | MatchChatMessageEvent
  | HeroSelectStartEvent
  | HeroSelectUpdateEvent
  | HeroSelectCompleteEvent
  | HeroSelectCancelledEvent
  | LobbiesUpdateEvent
  | LobbyUpdateEvent
  | LobbyLeftEvent
  | LobbyClosedEvent
  | Readonly<Record<string, unknown>>;
