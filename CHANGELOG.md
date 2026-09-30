# Changelog

## 2.0.1

**Trading: more items**

- Runewords, magic, rare and crafted items can now be traded.
- Magic and rare items are checked against the affixes their base can really roll. Crafted items are made exactly as listed.
- Listings with an OR now drop the option you can't pay with (like a Random Minor Key) and let you pay the other.
- Better screenshot reading: smaller screenshots, stats run together ("+31Tolife") and stat names that look like runeword names.
- Fixed skill tab bonuses ("+3 to Eldritch Skills") being saved to the wrong tab.

## 2.0.0

**New Single Player Trading Support**

- Paste or drop a Traderie screenshot to trade for the item listed.
- The listing must be PC, Ladder, Reign of the Warlock and under 3 days old, and match your Softcore/Hardcore file.
- Every roll is checked against the item's real range. Rolls the listing doesn't show are randomized.
- Currently supports uniques, set items (including full sets), runeword bases, runes, gems, keys and uber parts.
- Magic, rare and crafted items and runewords aren't supported yet.
- You pay what the listing asks: drag the runes, gems or keys it's trading for into your offer to unlock Accept.

## 1.1.3

- Clearer set bonuses in tooltips: grouped under small headings ("This item · 2 pieces", the set's name, "2 pieces", "Full set") in smaller text, with the set-wide bonuses in a softer green, instead of "(2 items)" after every line.

## 1.1.2

- The app remembers your save folder and reopens it at launch, so you only choose it once (handy on Linux, where saves live inside a Proton/Wine prefix). Settings → "Open a different folder" switches to another one; if the folder has moved, you're asked to choose again.

## 1.1.1

- On start, the fullest vault opens on the left and your most recently played character on the right.
- New **⇄ Switch sides** button under the panes, and clicking a file's Left/Right tag in the sidebar swaps the two sides.

## 1.1.0

- Hover any unique, set item or runeword in the collection tabs, found or not, to see its stats, with the possible range for each roll (e.g. "+(10–15)% to Lightning Skill Damage"). Runewords list their runes, bases and socket count, and which runes you're still missing.
- Found uniques, set items and runewords show each variable stat's range next to your roll, with a ★ when it's perfect.
- Set items show the set's partial and full bonuses.

## 1.0.1

- Backups keep only the last 10 copies of each save file, so the backups folder no longer grows forever (copies kept when you delete a character or vault are never removed).
- On start, your most recently played character opens on the left and your fullest vault on the right.

## 1.0.0

- Vaults are now stored in a `HoradricLootBox-Vaults` folder inside your D2R save folder, next to your characters, so one backup covers both. Vaults from earlier versions are copied there automatically on first launch; the old copies are left in place with a note.
- Built-in updater: checks GitHub releases on launch and installs with one click.
- First public release: two-pane muling, equipping from anywhere, unlimited vaults, grail tabs (uniques, sets, runewords, runes, gems), Stackables and gold transfers, game art from your own files, and safe, verified saving.
