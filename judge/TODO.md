# Judge app: to do

Ideas agreed but not built yet, roughly in the order planned.

1. **Hand a game to another device (link / QR).** "ส่งต่อเกม" builds a link that
   carries the whole game in the URL, also shown as a QR code. Opening it adds the
   game to that device's list. A copy, not a sync. Nothing is stored on a server,
   so player names stay on the devices. Move to Supabase only if live sync across
   devices turns out to be needed (that would store names on the server: needs a
   new notice and a way to delete).
2. **Try it for real on a phone and an iPad.** Check the keyboard stays up when
   pressing timer and judge buttons.
3. **Two game modes**, chosen at setup. The app plays normal mode today.

   |                     | Normal (ปกติ)               | Competition (แข่ง)              |
   |---------------------|-----------------------------|---------------------------------|
   | First word of round | first player says any word  | the judge picks it (GM word)    |
   | After someone is out| next player starts free     | next player must connect to the latest counted word |
   | Rounds per match    | 4                           | 3                               |

   The GM word counts as the first word: the first player must connect to it,
   "ไม่เชื่อม" and challenges apply from the first player, its syllables count as
   used. In competition mode `mustConnect` just never resets on an elimination.
4. **Send split corrections to Supabase.** Every "แก้การแยก" is a segmenter mistake.
   Needs the in-game notice like the old app, and production only so test data
   does not mix with real data.
5. **Switch production to the judge app** (merge to master). Render keeps the old app.
6. **Matches of several rounds and scores.** A successful challenge earns the
   challenger points; the log already records who challenged (`challengerId` on the
   judge event). Open questions:
   - points for winning a round, and for a successful challenge
   - can syllables used in one round be used again in the next, or not all match
   - who starts each new round (same player, or rotate)
   - the match winner: total points, or rounds won
7. **Landscape / iPad layout.**
