/**
 * A best-effort check that text headed for an agent does not carry a secret. It catches the common
 * shapes (private keys, well-known token prefixes, `password=` pairs, 64-hex keys, a recovery
 * phrase) and says only yes or no: the matched text is never returned or logged. It is a speed bump
 * for a person pasting the wrong thing, not a guarantee.
 */
const SECRET_SHAPES: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/,
  /\bsk-[A-Za-z0-9]{24,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/,
  /\b(?:0x)?[0-9a-fA-F]{64}\b/,
  /\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*\S{6,}/i,
];

const PHRASE_HINT = /\b(?:seed phrase|recovery phrase|mnemonic|secret recovery)\b/i;
const WORD_RUN = /(?:\b[a-z]{3,8}\b[ ,]+){11,}\b[a-z]{3,8}\b/;

export function looksLikeSecret(text: string): boolean {
  if (SECRET_SHAPES.some((shape) => shape.test(text))) {
    return true;
  }
  return PHRASE_HINT.test(text) && WORD_RUN.test(text);
}
