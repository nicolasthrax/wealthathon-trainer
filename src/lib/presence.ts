'use client';
import { useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './store';

/** Who is signed in to the app right now, via one shared Supabase Realtime presence channel. */
export interface OnlineUser { userId: string; name: string; where: string; since: string }

let channel: RealtimeChannel | null = null;
let channelUser: string | null = null;
let current: OnlineUser[] = [];
let me: OnlineUser | null = null;
const listeners = new Set<(u: OnlineUser[]) => void>();

function emit() {
  const state = channel?.presenceState<OnlineUser>() ?? {};
  current = Object.values(state).map((v) => v[0]).filter(Boolean);
  listeners.forEach((l) => l(current));
}

function connect(userId: string, name: string, where: string) {
  if (!supabase) return;
  me = { userId, name, where, since: me?.userId === userId ? me.since : new Date().toISOString() };
  if (channel && channelUser === userId) { void channel.track(me); return; }
  if (channel) void supabase.removeChannel(channel);
  channelUser = userId;
  channel = supabase.channel('online-users', { config: { presence: { key: userId } } })
    .on('presence', { event: 'sync' }, emit);
  channel.subscribe((status) => { if (status === 'SUBSCRIBED' && me) void channel?.track(me); });
}

/** Label for the page a user is on, shown to the other player. */
export function whereLabel(path: string): string {
  if (path.startsWith('/play')) return 'in a session';
  if (path.startsWith('/debrief')) return 'reading a debrief';
  if (path.startsWith('/pitch')) return 'practising a pitch';
  if (path.startsWith('/leaderboard')) return 'on the leaderboard';
  if (path.startsWith('/progress')) return 'on progress';
  return 'on the home page';
}

/** Announce yourself (when userId is set) and get the live list of online users. */
export function usePresence(userId?: string, name?: string, where = ''): OnlineUser[] {
  const [users, setUsers] = useState<OnlineUser[]>(current);
  useEffect(() => {
    listeners.add(setUsers);
    setUsers(current);
    return () => { listeners.delete(setUsers); };
  }, []);
  useEffect(() => { if (userId && name) connect(userId, name, where); }, [userId, name, where]);
  return users;
}

/** Leave the channel on sign-out so the other player sees you go offline at once. */
export function leavePresence() {
  if (channel) void supabase?.removeChannel(channel);
  channel = null; channelUser = null; me = null; current = [];
  listeners.forEach((l) => l(current));
}
