'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase, useStore } from '@/lib/store';

/** Private app: every page except /login requires a signed-in (allowlisted) account. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, ready } = useStore();
  const path = usePathname();
  const router = useRouter();
  const open = !supabase || path === '/login';
  useEffect(() => { if (!open && ready && !user) router.replace('/login'); }, [open, ready, user, router]);
  if (open || (ready && user)) return <>{children}</>;
  return <div className="page dim">Loading…</div>;
}
