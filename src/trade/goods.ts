import { GD, GEM_CODES, RUNE_CODES, UBER_CODES } from '../core';

/** What can be paid with in a trade: runes, gems, and uber keys and parts. */
export const TRADE_CODES = [...RUNE_CODES, ...GEM_CODES, ...UBER_CODES];
export const isTradeable = (code: string) => TRADE_CODES.includes(code);
export const nameOf = (code: string) => GD.items[code]?.name ?? code;
