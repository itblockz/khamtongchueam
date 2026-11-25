// Optional Google sign-in, and backup of a signed-in judge's games to their account.
//
// The browser talks to Supabase directly with the project's publishable key, which is
// meant to be public: row-level security on `user_games` lets each signed-in user
// read and write only their own rows. Playing never needs an account.

import { createClient, type Session } from '@supabase/supabase-js'
import type { SavedGame } from './storage'

const SUPABASE_URL = 'https://lwjgtahzviaqgggabykm.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bWqEkhNSaOKW3OSzeIaAVQ_kV93r5s6'

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
})

export interface Account {
  id: string
  email: string | null
}

function toAccount(session: Session | null): Account | null {
  return session ? { id: session.user.id, email: session.user.email ?? null } : null
}

/** Calls `listener` now and whenever the user signs in or out. Returns an unsubscribe. */
export function watchAccount(listener: (account: Account | null) => void): () => void {
  void supabase.auth.getSession().then(({ data }) => listener(toAccount(data.session)))
  const { data } = supabase.auth.onAuthStateChange((_event, session) => listener(toAccount(session)))
  return () => data.subscription.unsubscribe()
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

/** Delete the account and every game backed up to it. */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_my_account')
  if (error) throw error
  await supabase.auth.signOut()
}

/** One game as the account keeps it: the game, or a tombstone once it was deleted. */
export interface RemoteGame {
  id: string
  updatedAt: number
  deleted: boolean
  game: SavedGame | null
}

export async function pullGames(): Promise<RemoteGame[]> {
  const { data, error } = await supabase.from('user_games').select('id, game, updated_at, deleted')
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: String(row.id),
    updatedAt: Number(row.updated_at),
    deleted: Boolean(row.deleted),
    game: row.deleted ? null : (row.game as SavedGame),
  }))
}

/** Save games (and tombstones) to the account; the server keeps whichever copy is newer. */
export async function pushGames(games: RemoteGame[]): Promise<void> {
  for (let i = 0; i < games.length; i += 50) {
    const batch = games.slice(i, i + 50).map((g) => ({
      id: g.id,
      updated_at: g.updatedAt,
      deleted: g.deleted,
      game: g.game ?? {},
    }))
    const { error } = await supabase.rpc('save_my_games', { p_games: batch })
    if (error) throw error
  }
}
