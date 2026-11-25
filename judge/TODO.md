# Judge app: to do

Ideas agreed but not built yet, roughly in the order planned.

1. ~~Optional sign-in with backup~~ done (Google only). Games on a device belong to
   an account or to nobody (played signed out); each person sees and backs up only
   their own, and the player-names box is kept per person too. Signing in asks
   before adding signed-out games; signing out keeps the account's games hidden on
   the device unless the judge ticks "remove from this device". Notes from the plan:
   - Signed out: games stay on the device (IndexedDB, done) and move between
     devices with export/import files. A link/QR hand-over was built and dropped:
     long games do not fit LINE messages or QR codes, and one way for every game
     is clearer.
   - Signed in: every game is backed up to the account and shows on every device
     signed in to it. Games played before signing in are merged in. Signing out
     keeps games on the device. Offline play syncs later.
   - Sign-in: Google and an emailed code first (needs Google Cloud OAuth set up by
     the owner, and an SMTP service such as Gmail with an app password, since
     Supabase's built-in mail is for testing only). LINE later if asked for: not a
     built-in Supabase provider, so it needs a custom bridge.
   - Player names are stored readable, visible only to the account owner through
     row-level security (and to project admins). Update the in-app notice, and add
     a button that deletes the account with all its games (PDPA).
2. **Try it for real on a phone and an iPad.** Check the keyboard stays up when
   pressing timer and judge buttons.
3. ~~Two game modes~~ done. Normal: free first word, and a free start after someone
   goes out. Competition: the judge gives an opening word each round (it counts as
   the first word, its syllables are used, players connect to it), and play keeps
   connecting to the latest counted word after an elimination. Rounds per match
   (normal 4, competition 3) come with item 6.
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
6. ~~Matches of several rounds and scores~~ done. Normal 4 rounds, competition 3.
   Per round: winner 3 (2 for winning + 1 for being in the last three), second and
   third 1 each, a successful challenge 2 to the challenger. Syllables may repeat
   across rounds. Next round: the previous winner starts and play goes the other
   way round the table. Highest total wins the match; equal totals are a tie.
7. **Player stats across games**, worked out on the judge's device from its saved
   games (names never leave the device): games played and won, how players go out,
   successful challenges, words per game. Games from other devices can be merged
   in with import first.
   - Names must match across games ("ใบปอ" vs "ปอ" would be two people). Suggest
     names from earlier games in the setup box; worth doing before the stats page
     so names match from the start.
   - On the stats page, allow merging two names that are the same person.
8. **Landscape / iPad layout.**
