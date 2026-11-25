# Judge app: to do

Ideas agreed but not built yet, roughly in the order planned.

1. ~~Hand a game to another device (link / QR)~~ done: "ส่งต่อ" on a saved game
   gives a link with the game compressed in its #fragment (never sent to the
   server), shown as a QR code when short enough (an 82-word game is ~1,400
   characters). Live sync across devices via Supabase only if it turns out to be
   needed (it would store names on the server: needs a new notice and deletion).
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
4. ~~Send games to Supabase~~ done: `judge_games`, one anonymous row per game.
   Next: tools to review the data (segmenter corrections, nouns, connections,
   forbidden words). Player stats can be built later from games kept on the device.
   **Never feed game data straight into the segmenter or word lists.** Judges make
   mistakes, so a game's split or decision is only a candidate: it goes to review,
   and only what a person confirms is used (like the verified gold set).
   The review page should show how often the same word got the same split or
   decision across games and judges: agreement is the best signal of what is right.
   Marking games from trusted judges (a judge code set as a secret on Vercel) is
   not planned. Do it only if junk games from the public link become too many to
   review.
5. **Switch production to the judge app** (merge to master). Render keeps the old app.
6. **Matches of several rounds and scores.** A successful challenge earns the
   challenger points; the log already records who challenged (`challengerId` on the
   judge event). Open questions:
   - points for winning a round, and for a successful challenge
   - can syllables used in one round be used again in the next, or not all match
   - who starts each new round (same player, or rotate)
   - the match winner: total points, or rounds won
7. **Player stats across games**, worked out on the judge's device from its saved
   games (names never leave the device): games played and won, how players go out,
   successful challenges, words per game. Games from other devices can be merged
   in with import first.
   - Names must match across games ("ใบปอ" vs "ปอ" would be two people). Suggest
     names from earlier games in the setup box; worth doing before the stats page
     so names match from the start.
   - On the stats page, allow merging two names that are the same person.
8. **Landscape / iPad layout.**
