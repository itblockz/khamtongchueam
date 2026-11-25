// Hand one game to another device as a link (also shown as a QR code).
//
// The whole game rides in the link's #fragment, compressed. A fragment is never sent
// to the server, so the game (player names included) only goes where the judge
// shares the link. Opening it adds a copy to that device's game list: a copy, not a
// sync, so the game should carry on on one device only.

import { isGame, type SavedGame } from './storage'

const PREFIX = 'game='
const VERSION = 'g1.'

/** QR codes past about this many characters get too dense to scan from a screen. */
export const QR_MAX_LENGTH = 1800

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/** The link that carries `game`, on this site. */
export async function shareLink(game: SavedGame, origin = window.location.origin): Promise<string> {
  const packed = toBase64Url(await deflate(JSON.stringify(game)))
  return `${origin}/#${PREFIX}${VERSION}${packed}`
}

/** The game in a link's fragment (`#game=...`), or null if there is none or it is broken. */
export async function readShared(hash: string): Promise<SavedGame | null> {
  const fragment = hash.replace(/^#/, '')
  if (!fragment.startsWith(PREFIX + VERSION)) return null
  try {
    const game: unknown = JSON.parse(await inflate(fromBase64Url(fragment.slice(PREFIX.length + VERSION.length))))
    return isGame(game) ? game : null
  } catch {
    return null
  }
}

export function hasSharedGame(hash: string): boolean {
  return hash.replace(/^#/, '').startsWith(PREFIX)
}
