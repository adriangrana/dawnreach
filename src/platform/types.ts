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

export type PresenceSnapshot = Readonly<{
  type: 'presence.snapshot';
  users: readonly PlatformUser[];
}>;

export type SessionReadyEvent = Readonly<{
  type: 'session.ready';
  user: PlatformUser;
  presence: readonly PlatformUser[];
}>;

export type PlatformRealtimeEvent = PresenceSnapshot | SessionReadyEvent | Readonly<Record<string, unknown>>;
