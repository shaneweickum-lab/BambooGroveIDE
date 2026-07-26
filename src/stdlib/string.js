// Python's string module (spec 3.2) — a handful of character-class
// constants, character-for-character identical to CPython's own values
// (cross-checked against a real `python3 -c "import string; ..."` run).
// No state, no dependencies — the simplest possible stdlib mock, used to
// prove the import-resolution hook (src/modules.js's STDLIB_MODULE_NAMES)
// end to end before anything harder is built on top of it.
const ascii_lowercase = "abcdefghijklmnopqrstuvwxyz";
const ascii_uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ascii_letters = ascii_lowercase + ascii_uppercase;
const digits = "0123456789";
const hexdigits = "0123456789abcdefABCDEF";
const octdigits = "01234567";
const punctuation = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const whitespace = " \t\n\r\x0b\x0c";
const printable = digits + ascii_letters + punctuation + whitespace;

export const STRING_MODULE = Object.freeze({
  ascii_lowercase,
  ascii_uppercase,
  ascii_letters,
  digits,
  hexdigits,
  octdigits,
  punctuation,
  whitespace,
  printable,
});
