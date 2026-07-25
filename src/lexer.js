// Tokenizer for BambooScript. Produces a flat token stream with Python-style
// INDENT/DEDENT tokens so the parser never has to look at raw whitespace.

export { BambooSyntaxError } from "./errors.js";
import { BambooSyntaxError } from "./errors.js";

const KEYWORDS = new Set([
  "def", "return", "if", "elif", "else", "for", "in", "while",
  "and", "or", "not", "True", "False",
  "import", "from", "as",
]);

const SINGLE_CHAR_OPS = {
  "(": "(", ")": ")", "[": "[", "]": "]", ",": ",", ":": ":", ".": ".",
  "+": "+", "-": "-", "*": "*", "/": "/", "%": "%",
};

function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}

function isNameStart(ch) {
  return /[A-Za-z_]/.test(ch);
}

function isNameChar(ch) {
  return /[A-Za-z0-9_]/.test(ch);
}

export function tokenize(source) {
  const tokens = [];
  const indentStack = [0];
  let pos = 0;
  let line = 1;
  let parenDepth = 0;
  let atLineStart = true;
  const len = source.length;

  function push(type, value) {
    tokens.push({ type, value, line });
  }

  while (pos < len) {
    if (atLineStart && parenDepth === 0) {
      const lineStart = pos;
      let indent = 0;
      while (pos < len && (source[pos] === " " || source[pos] === "\t")) {
        indent += source[pos] === "\t" ? 8 : 1;
        pos++;
      }
      // Blank line or comment-only line: skip without touching indent stack.
      if (pos >= len || source[pos] === "\n" || source[pos] === "\r" || source[pos] === "#") {
        while (pos < len && source[pos] !== "\n") pos++;
        if (pos < len) { pos++; line++; }
        continue;
      }
      void lineStart;
      if (indent > indentStack[indentStack.length - 1]) {
        indentStack.push(indent);
        push("INDENT", indent);
      } else {
        while (indent < indentStack[indentStack.length - 1]) {
          indentStack.pop();
          push("DEDENT", null);
        }
        if (indent !== indentStack[indentStack.length - 1]) {
          throw new BambooSyntaxError("Inconsistent indentation.", line);
        }
      }
      atLineStart = false;
    }

    const ch = source[pos];

    if (ch === "\n") {
      pos++;
      if (parenDepth === 0) {
        push("NEWLINE", null);
        atLineStart = true;
      }
      line++;
      continue;
    }

    if (ch === "\r") { pos++; continue; }
    if (ch === " " || ch === "\t") { pos++; continue; }

    if (ch === "#") {
      while (pos < len && source[pos] !== "\n") pos++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const startLine = line;
      pos++;
      let value = "";
      while (pos < len && source[pos] !== quote) {
        if (source[pos] === "\n") {
          throw new BambooSyntaxError("String literal is missing its closing quote.", startLine);
        }
        if (source[pos] === "\\" && pos + 1 < len) {
          const next = source[pos + 1];
          const escapes = { n: "\n", t: "\t", '"': '"', "'": "'", "\\": "\\" };
          value += escapes[next] !== undefined ? escapes[next] : next;
          pos += 2;
          continue;
        }
        value += source[pos];
        pos++;
      }
      if (pos >= len) {
        throw new BambooSyntaxError("String literal is missing its closing quote.", startLine);
      }
      pos++; // closing quote
      push("STRING", value);
      continue;
    }

    if (isDigit(ch)) {
      let start = pos;
      while (pos < len && isDigit(source[pos])) pos++;
      if (source[pos] === "." && isDigit(source[pos + 1])) {
        pos++;
        while (pos < len && isDigit(source[pos])) pos++;
      }
      push("NUMBER", Number(source.slice(start, pos)));
      continue;
    }

    if (isNameStart(ch)) {
      let start = pos;
      while (pos < len && isNameChar(source[pos])) pos++;
      const word = source.slice(start, pos);
      if (KEYWORDS.has(word)) {
        push(word, word);
      } else {
        push("NAME", word);
      }
      continue;
    }

    // Two-character operators first.
    const two = source.slice(pos, pos + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=") {
      push(two, two);
      pos += 2;
      continue;
    }

    if (ch === "=" || ch === "<" || ch === ">") {
      push(ch, ch);
      pos++;
      continue;
    }

    if (ch === "(" || ch === "[") {
      parenDepth++;
      push(SINGLE_CHAR_OPS[ch], ch);
      pos++;
      continue;
    }
    if (ch === ")" || ch === "]") {
      parenDepth = Math.max(0, parenDepth - 1);
      push(SINGLE_CHAR_OPS[ch], ch);
      pos++;
      continue;
    }

    if (SINGLE_CHAR_OPS[ch]) {
      push(SINGLE_CHAR_OPS[ch], ch);
      pos++;
      continue;
    }

    throw new BambooSyntaxError(`Unexpected character '${ch}'.`, line);
  }

  if (tokens.length && tokens[tokens.length - 1].type !== "NEWLINE") {
    push("NEWLINE", null);
  }
  while (indentStack.length > 1) {
    indentStack.pop();
    push("DEDENT", null);
  }
  push("EOF", null);
  return tokens;
}
