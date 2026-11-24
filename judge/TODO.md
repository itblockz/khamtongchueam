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
3. **GM opening word.** It counts as the first word: the first player must connect
   to it, "ไม่เชื่อม" is available from the first player, and its syllables count
   as used.
4. **Send split corrections to Supabase.** Every "แก้การแยก" is a segmenter mistake.
   Needs the in-game notice like the old app, and production only so test data
   does not mix with real data.
5. **Switch production to the judge app** (merge to master). Render keeps the old app.
6. **Scores across rounds** (who won how many).
7. **Challenge** (a player disputes a decision). Agree the rules first.
8. **Landscape / iPad layout.**
