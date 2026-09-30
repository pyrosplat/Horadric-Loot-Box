# Changelog

## 2.2.0

**Selling and item trades**

- New Buy / Sell switch in Trade. In Sell, import a buyer's listing and sell them the item, runes or gems at their offer/ give prices.
- Drag what the buyer wants into your offer and pick which of their options you get. Rolls the listing shows are minimums; any other roll counts.
- Prices can include items: pay for a listing with a unique, set item, full set, runeword or base (any rolls).
- Older listings show the date they were posted - these now count toward the 3-day limit.
- When a price is cut off that option is left out and you pay one of the others.
- Better screenshot reading: small grey post times and cards with the seller above the picture.

## 2.0.1

**Trading: more items**

- Runewords, magic, rare and crafted items can now be traded.
- Magic and rare items are checked against the affixes their base can really roll. Crafted items are made exactly as listed.
- Runeword listings count the runes' own bonuses and a superior base's Enhanced Defense/Damage
- Listings with an OR now drop the option you can't pay with
- Better screenshot reading: smaller screenshots, stats run together and stat names that look like runeword names.


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
