import { GD, isUberCode, itemName, type D2Item } from '../core';

/** One line of a trade: how many of what ("2", "Ist Rune"). */
export interface TradeLogLine {
  qty: number;
  name: string;
}

/** A trade made in the Trade panel: what you got and what you paid. */
export interface TradeLogEntry {
  id: string;
  /** When it was made (ISO). */
  at: string;
  side: 'buy' | 'sell';
  got: TradeLogLine[];
  paid: TradeLogLine[];
  mode: 'softcore' | 'hardcore';
  /** The character or stash it was paid from. */
  file: string;
  /**
   * Whether the files were saved afterwards. A trade only lands in the game when you save, so trades that aren't
   * saved yet are kept in memory only and are dropped if you undo, discard or reload.
   */
  saved: boolean;
}

const KEY = 'hlb-trade-log';
/** The log keeps the newest trades, up to this many. */
export const TRADE_LOG_MAX = 200;

/** Items as log lines: runes, gems and uber items counted by kind; other items one line each. */
export function tradeLines(items: D2Item[]): TradeLogLine[] {
  const out: TradeLogLine[] = [];
  for (const it of items) {
    const stacks = it.compact || isUberCode(it.code);
    const name = stacks ? (GD.items[it.code]?.name ?? it.code) : itemName(it);
    const line = stacks ? out.find((l) => l.name === name) : undefined;
    if (line) line.qty++;
    else out.push({ qty: 1, name });
  }
  return out;
}

/** "2× Ist Rune, Harlequin Crest" */
export const tradeLineText = (lines: TradeLogLine[]) => lines.map((l) => (l.qty > 1 ? `${l.qty}× ${l.name}` : l.name)).join(', ');

/** The saved log, newest first (empty if there is none or storage is unavailable). */
export function loadTradeLog(): TradeLogEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((e) => e && typeof e.at === 'string' && Array.isArray(e.got) && Array.isArray(e.paid)).map((e) => ({ ...e, saved: true })) : [];
  } catch {
    return [];
  }
}

/** Keeps the saved trades (the ones not saved yet stay in memory). */
export function storeTradeLog(log: TradeLogEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(log.filter((e) => e.saved).slice(0, TRADE_LOG_MAX)));
  } catch {
    /* no storage: the log lasts as long as the page */
  }
}

/** The log as text, newest first, for copying. */
export function tradeLogText(log: TradeLogEntry[]): string {
  return log
    .map((e) => `${new Date(e.at).toLocaleString()}  ${e.side === 'sell' ? 'Sold' : 'Bought'} (${e.mode}, ${e.file}): got ${tradeLineText(e.got)} for ${tradeLineText(e.paid)}`)
    .join('\n');
}
