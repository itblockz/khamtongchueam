# Syllable benchmark

```bash
npm run benchmark:syllables
```

## Gold sets

| File | What it holds | Who may change it |
| --- | --- | --- |
| `gold_verified_syllables.json` | 146 words reviewed and confirmed one by one by the project owner (2026-11-23). Single Thai words only: entries with symbols or spaces were removed because the game does not accept them. This is the score that counts. | Only from the owner's own review. |
| `gold_unverified_syllables.json` (optional) | Proposed words and segmentations nobody has confirmed yet. Reported separately. | Anyone. Move an entry to the verified file only after the owner confirms it. |

Each entry:

```json
{"text": "ประวัติศาสตร์", "syllables": ["ประ", "วัติ", "ศาสตร์"], "accept": [["ประ", "วัติ", "ติ", "ศาสตร์"]], "spoken_syllables": 3, "category": "pali_sanskrit"}
```

- `syllables`: the segmentation the game uses.
- `accept` (optional): other segmentations that also count as correct.
- `spoken_syllables`: number of syllables when read aloud. Not used by the game.

## Segmentation rules (decided by the project owner)

1. Split every syllable, including a consonant with an unwritten vowel: `ส|บาย`, `ม|หา`, `กระ|เป๋า`.
2. Never split a leading-consonant pair (อักษรนำ): `ขนม`, `ตลาด`, `หมา`.
3. Do not repeat a consonant that is pronounced twice: `ราช|การ`. Exceptions are listed in `SYLLABLE_EXCEPTIONS` in `backend/app/syllables.py` (e.g. `อุ|บัติ|ติ|เหตุ`).
4. Symbols are not supported and are dropped: `ๆ`, `ฯ`, `!`.
5. A syllable is a duplicate only if it is written the same way (and therefore read the same way).


## Words from real games (`from_games`)

Common words played in real games with the judge app, whose splits the project
owner confirmed (2026-11-25), are in the verified set under the category
`from_games`. Only ordinary words are included: names of people, brands, titles,
places and other proper nouns from the games stay out of this public repository.
