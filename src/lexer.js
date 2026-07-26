// Tokenizer for BambooScript. Produces a flat token stream with Python-style
// INDENT/DEDENT tokens so the parser never has to look at raw whitespace.

export { BambooSyntaxError } from "./errors.js";
import { BambooSyntaxError } from "./errors.js";

const KEYWORDS = new Set([
  "def", "return", "if", "elif", "else", "for", "in", "while",
  "and", "or", "not", "True", "False",
  "import", "from", "as",
  "try", "except", "finally", "raise",
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

  function push(type, value, extra) {
    tokens.push(extra ? { type, value, line, ...extra } : { type, value, line });
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

    if ((ch === "f" || ch === "F") && (source[pos + 1] === '"' || source[pos + 1] === "'")) {
      pos++; // consume the 'f'
      const quote = source[pos];
      const startLine = line;
      pos++; // consume the opening quote
      const parts = [];
      let buf = "";
      while (pos < len && source[pos] !== quote) {
        const c = source[pos];
        if (c === "\n") {
          throw new BambooSyntaxError("f-string is missing its closing quote.", startLine);
        }
        if (c === "\\" && pos + 1 < len) {
          const next = source[pos + 1];
          const escapes = { n: "\n", t: "\t", '"': '"', "'": "'", "\\": "\\" };
          buf += escapes[next] !== undefined ? escapes[next] : next;
          pos += 2;
          continue;
        }
        if (c === "{" && source[pos + 1] === "{") { buf += "{"; pos += 2; continue; }
        if (c === "}" && source[pos + 1] === "}") { buf += "}"; pos += 2; continue; }
        if (c === "}") {
          throw new BambooSyntaxError("f-string has a stray '}' — use '}}' for a literal brace.", startLine);
        }
        if (c === "{") {
          if (buf) { parts.push({ type: "text", value: buf }); buf = ""; }
          pos++; // consume '{'
          const exprStart = pos;
          let depth = 0; // nesting of ( and [ only — BambooScript has no {} literals
          let inString = null;
          let specStart = -1;
          while (pos < len) {
            const cc = source[pos];
            if (inString) {
              if (cc === "\\") { pos += 2; continue; }
              if (cc === inString) inString = null;
              pos++;
              continue;
            }
            if (cc === '"' || cc === "'") { inString = cc; pos++; continue; }
            if (cc === "(" || cc === "[") { depth++; pos++; continue; }
            if (cc === ")" || cc === "]") { depth--; pos++; continue; }
            if (cc === ":" && depth === 0 && specStart === -1) { specStart = pos; pos++; continue; }
            if (cc === "}" && depth === 0) break;
            if (cc === "\n") {
              throw new BambooSyntaxError("f-string expression is missing its closing '}'.", startLine);
            }
            pos++;
          }
          if (pos >= len) {
            throw new BambooSyntaxError("f-string expression is missing its closing '}'.", startLine);
          }
          const exprEnd = specStart === -1 ? pos : specStart;
          const exprSource = source.slice(exprStart, exprEnd).trim();
          const spec = specStart === -1 ? null : source.slice(specStart + 1, pos).trim();
          if (!exprSource) {
            throw new BambooSyntaxError("f-string has an empty '{}' expression.", startLine);
          }
          parts.push({ type: "expr", source: exprSource, spec, line: startLine });
          pos++; // consume closing '}'
          continue;
        }
        buf += c;
        pos++;
      }
      if (pos >= len) {
        throw new BambooSyntaxError("f-string is missing its closing quote.", startLine);
      }
      if (buf) parts.push({ type: "text", value: buf });
      pos++; // closing quote
      push("FSTRING", parts);
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
      let isFloat = false;
      while (pos < len && isDigit(source[pos])) pos++;
      if (source[pos] === "." && isDigit(source[pos + 1])) {
        isFloat = true;
        pos++;
        while (pos < len && isDigit(source[pos])) pos++;
      }
      push("NUMBER", Number(source.slice(start, pos)), { isFloat });
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
    if (two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "//") {
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
