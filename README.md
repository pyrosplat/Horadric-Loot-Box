# Horadric Loot Box

A muling and holy-grail tool for **Diablo II: Resurrected: Reign of the Warlock**. Created by **PyroSplat**.

![Character and vault side by side](docs/screenshots/main.png)

## Features

- **Two-pane muling:** drag characters, stashes or vaults onto either side, then drag items between them.
- **Equip from anywhere:** characters, weapon swap, mercenaries and belts, with real item tooltips.
- **Unlimited vaults** with search, filters and sorting.
- **Holy grail tabs** for uniques, sets, runewords, runes and gems, counted across your account.
- **Character screen** with stats, resistances, and breakpoints (including attack speed) that follow your gear.
- **Offline trading** from Traderie screenshots.
- **Safe saving:** a backup before every save, no saving while the game runs, Softcore and Hardcore never mix.
- **Automatic updates** from GitHub releases.

| Uniques | Runewords | Stackables |
| --- | --- | --- |
| ![Uniques collection](docs/screenshots/uniques.png) | ![Runewords collection](docs/screenshots/runewords.png) | ![Stackables tab](docs/screenshots/stackables.png) |

## Getting started

1. Close Diablo II: Resurrected.
2. Open Horadric Loot Box. It finds your save folder, or you can choose it.
3. Drag a character, stash or vault from the sidebar onto either side.
4. Move items, then click **Save**.

**Game art (optional):** set your D2R install folder in **Settings → Items** to show item pictures. Art is read from your own files; nothing is uploaded.

**Saves:** `%USERPROFILE%\Saved Games\Diablo II Resurrected` (or the same path in your Proton/Wine prefix).
**Vaults:** a `HoradricLootBox-Vaults` folder inside your save folder.
**Backups:** the last 10 copies of each file, in `%APPDATA%\com.horadriclootbox.app\backups` (Linux: `~/.local/share/com.horadriclootbox.app/backups`).

## Offline trading

Trade in single player for items listed on Traderie, at the listing's price. Turn it on in **Settings → Trade**, then click **Trade**.

[![Offline trading demo (click to play)](docs/screenshots/trade.png)](docs/videos/trade.mp4)

- **Buy:** paste or drop a Traderie listing, drag what it asks for into **Your offer**, then **Accept trade**.
- **Sell:** switch to **Sell**, import the buyer's listing, drag in what they want, then **Sell**.
- What you get lands in **Received**; move it into a stash, character or vault and save.
- Listings must be PC, Ladder, Reign of the Warlock, posted in the last 3 days, and match your Softcore/Hardcore file. Screenshots are read on your computer.

**In your browser:** [Horadric Trading Post](https://pyrosplat.github.io/Horadric-Loot-Box/) is the Trade panel as a web page. Drop in your `.d2i`, `.d2s` or save folder, trade, then save.

## Shortcuts

| Keys | Action |
| --- | --- |
| Ctrl + S / Z / F | Save / Undo / Search |
| Ctrl + click, drag a box | Select several items |
| Shift + drag or double-click | Move 3 stackables at once |
| Right-click / Delete | Delete (asks first) |
| Ctrl + / − / 0 | Interface size |

## Limits

- Items on a corpse can't be moved until the body is picked up.
- Supports D2R saves v97–v105. Original 1.14 saves and mods aren't supported.

## Development

```bash
npm install
npm test
npm run dev            # browser version
npm run desktop:dev    # desktop app (Tauri)
npm run desktop:build  # installers
```

## Credits

- [CascLib](https://github.com/ladislav-zezula/CascLib) (MIT).
- Save-format research: [D2SSharp](https://github.com/ResurrectedTrader/D2SSharp), [halbu](https://github.com/feored/halbu), [d2s](https://github.com/dschu012/d2s), [d07riv](https://github.com/d07RiV/d07riv.github.io) and [GoMule](https://gomule.sourceforge.io/).
- Attack speed: method and data from [Warren1001's IAS Calculator](https://github.com/Warren1001/IAS_Calculator), built on RuffnecKk's animation data.
- Game tables (© Blizzard) via [D2R-Excel](https://github.com/pinkufairy/D2R-Excel) and [d2data](https://github.com/blizzhackers/d2data); see [NOTICE](vendor/d2r-3.3/NOTICE.md).

Diablo® II: Resurrected™ is a trademark of Blizzard Entertainment, Inc. This project isn't affiliated with Blizzard. Back up your saves.
