# Game data notice

The `.txt` tables and `allstrings-eng.json` in this folder are Diablo II: Resurrected game data,
© Blizzard Entertainment, Inc. They are **not** covered by this project's MIT license.

They were taken from the community projects [pinkufairy/D2R-Excel](https://github.com/pinkufairy/D2R-Excel)
and [blizzhackers/d2data](https://github.com/blizzhackers/d2data) and are included only so the app can name
items and read save files (`npm run gamedata` builds `src/core/data/gamedata.json` from them). No game art,
audio or executable code is included; item pictures are read from the user's own game files at runtime.

If Blizzard asks for this data to be removed, delete this folder and ship `gamedata.json` built from the
user's own install instead.
