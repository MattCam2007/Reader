import { RSVP } from './constants.js';
import { PARAGRAPH_BREAK, endsSentence } from './tokenizer.js';

const TRAILING_CLOSERS = /[")'\]"\u2019]+$/;

export function lengthMultiplier(len, lengthStrength) {
  const extra = Math.max(0, len - RSVP.LEN_THRESHOLD);
  return 1 + extra * (lengthStrength / RSVP.LEN_SCALE);
}

export function durationMultiplier(token, prefs) {
  if (token === PARAGRAPH_BREAK) return 1 + prefs.paraPause / 100;
  let m = lengthMultiplier(token.length, prefs.lengthStrength);
  const trimmed = token.replace(TRAILING_CLOSERS, "");
  const last = trimmed.charAt(trimmed.length - 1);
  if (last === "," || last === ";" || last === ":") m = Math.max(m, 1 + prefs.commaPause / 100);
  if (endsSentence(token)) m = Math.max(m, 1 + prefs.periodPause / 100);
  return m;
}

export function rampSpeedFactor(rampRemaining) {
  if (rampRemaining <= 0) return 1;
  return 0.5 + (5 - rampRemaining) * 0.125;
}
