// Recursive-descent parser for BambooScript. Turns a token stream (see
// lexer.js) into an AST of plain objects, each carrying a `line` for
// mapping runtime/parse errors back to the original source.

import { tokenize, BambooSyntaxError } from "./lexer.js";

const COMPARE_OPS = new Set(["==", "!=", "<", ">", "<=", ">="]);

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset];
  }

  at(type) {
    return this.peek().type === type;
  }

  advance() {
    return this.tokens[this.pos++];
  }

  expect(type, message) {
    if (!this.at(type)) {
      const tok = this.peek();
      throw new BambooSyntaxError(
        message || `Expected '${type}' but found '${tok.value ?? tok.type}'.`,
        tok.line
      );
    }
    return this.advance();
  }

  skipNewlines() {
    while (this.at("NEWLINE")) this.advance();
  }

  parseProgram() {
    const body = [];
    this.skipNewlines();
    while (!this.at("EOF")) {
      body.push(this.parseFunctionDef());
      this.skipNewlines();
    }
    return { type: "Program", body };
  }

  parseFunctionDef() {
    const defTok = this.expect("def");
    const nameTok = this.expect("NAME", "Expected a function name after 'def'.");
    this.expect("(", `Expected '(' after function name '${nameTok.value}'.`);
    const params = [];
    if (!this.at(")")) {
      params.push(this.expect("NAME", "Expected a parameter name.").value);
      while (this.at(",")) {
        this.advance();
        params.push(this.expect("NAME", "Expected a parameter name.").value);
      }
    }
    this.expect(")", "Expected ')' after parameter list.");
    this.expect(":", "Expected ':' after function signature.");
    const body = this.parseBlock();
    return { type: "FunctionDef", name: nameTok.value, params, body, line: defTok.line };
  }

  parseBlock() {
    if (this.at("NEWLINE")) {
      this.advance();
      this.expect("INDENT", "Expected an indented block.");
      const body = [];
      while (!this.at("DEDENT") && !this.at("EOF")) {
        body.push(this.parseStatement());
      }
      this.expect("DEDENT", "Expected end of indented block.");
      return body;
    }
    // Single-line body: `if x: forward(1)`
    return [this.parseSimpleStatement()];
  }

  parseStatement() {
    switch (this.peek().type) {
      case "if":
        return this.parseIf();
      case "for":
        return this.parseFor();
      case "while":
        return this.parseWhile();
      default:
        return this.parseSimpleStatement();
    }
  }

  parseSimpleStatement() {
    let stmt;
    if (this.at("return")) {
      stmt = this.parseReturn();
    } else {
      stmt = this.parseExprOrAssign();
    }
    this.expect("NEWLINE", "Expected end of line.");
    return stmt;
  }

  parseIf() {
    const ifTok = this.expect("if");
    const cases = [];
    const test = this.parseExpr();
    this.expect(":", "Expected ':' after 'if' condition.");
    const body = this.parseBlock();
    cases.push({ test, body });
    let orelse = null;
    while (this.at("elif")) {
      this.advance();
      const elifTest = this.parseExpr();
      this.expect(":", "Expected ':' after 'elif' condition.");
      const elifBody = this.parseBlock();
      cases.push({ test: elifTest, body: elifBody });
    }
    if (this.at("else")) {
      this.advance();
      this.expect(":", "Expected ':' after 'else'.");
      orelse = this.parseBlock();
    }
    return { type: "If", cases, orelse, line: ifTok.line };
  }

  parseFor() {
    const forTok = this.expect("for");
    const varTok = this.expect("NAME", "Expected a loop variable name after 'for'.");
    this.expect("in", "Expected 'in' after the loop variable.");
    const iterable = this.parseExpr();
    this.expect(":", "Expected ':' after 'for' loop header.");
    const body = this.parseBlock();
    return { type: "For", varName: varTok.value, iterable, body, line: forTok.line };
  }

  parseWhile() {
    const whileTok = this.expect("while");
    const test = this.parseExpr();
    this.expect(":", "Expected ':' after 'while' condition.");
    const body = this.parseBlock();
    return { type: "While", test, body, line: whileTok.line };
  }

  parseReturn() {
    const retTok = this.expect("return");
    let value = null;
    if (!this.at("NEWLINE")) {
      value = this.parseExpr();
    }
    return { type: "Return", value, line: retTok.line };
  }

  parseExprOrAssign() {
    const line = this.peek().line;
    const expr = this.parseExpr();
    if (this.at("=")) {
      if (expr.type !== "Name" && expr.type !== "Index") {
        throw new BambooSyntaxError("Left-hand side of '=' must be a variable or list index.", line);
      }
      this.advance();
      const value = this.parseExpr();
      return { type: "Assign", target: expr, value, line };
    }
    return { type: "ExprStmt", value: expr, line };
  }

  // --- Expression grammar (lowest to highest precedence) ---

  parseExpr() {
    return this.parseOr();
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.at("or")) {
      const tok = this.advance();
      const right = this.parseAnd();
      left = { type: "BoolOp", op: "or", left, right, line: tok.line };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.at("and")) {
      const tok = this.advance();
      const right = this.parseNot();
      left = { type: "BoolOp", op: "and", left, right, line: tok.line };
    }
    return left;
  }

  parseNot() {
    if (this.at("not")) {
      const tok = this.advance();
      const operand = this.parseNot();
      return { type: "UnaryOp", op: "not", operand, line: tok.line };
    }
    return this.parseComparison();
  }

  parseComparison() {
    let left = this.parseArith();
    if (COMPARE_OPS.has(this.peek().type)) {
      const tok = this.advance();
      const right = this.parseArith();
      left = { type: "Compare", op: tok.type, left, right, line: tok.line };
    }
    return left;
  }

  parseArith() {
    let left = this.parseTerm();
    while (this.at("+") || this.at("-")) {
      const tok = this.advance();
      const right = this.parseTerm();
      left = { type: "BinOp", op: tok.type, left, right, line: tok.line };
    }
    return left;
  }

  parseTerm() {
    let left = this.parseFactor();
    while (this.at("*") || this.at("/") || this.at("%")) {
      const tok = this.advance();
      const right = this.parseFactor();
      left = { type: "BinOp", op: tok.type, left, right, line: tok.line };
    }
    return left;
  }

  parseFactor() {
    if (this.at("-") || this.at("+")) {
      const tok = this.advance();
      const operand = this.parseFactor();
      return { type: "UnaryOp", op: tok.type, operand, line: tok.line };
    }
    return this.parseTrailer();
  }

  parseTrailer() {
    let node = this.parseAtom();
    for (;;) {
      if (this.at("(")) {
        const tok = this.advance();
        const args = [];
        if (!this.at(")")) {
          args.push(this.parseExpr());
          while (this.at(",")) {
            this.advance();
            args.push(this.parseExpr());
          }
        }
        this.expect(")", "Expected ')' to close the argument list.");
        if (node.type !== "Name") {
          throw new BambooSyntaxError("Only a plain name can be called as a function.", tok.line);
        }
        node = { type: "Call", callee: node.name, args, line: tok.line };
      } else if (this.at("[")) {
        const tok = this.advance();
        const index = this.parseExpr();
        this.expect("]", "Expected ']' to close the index.");
        node = { type: "Index", object: node, index, line: tok.line };
      } else {
        break;
      }
    }
    return node;
  }

  parseAtom() {
    const tok = this.peek();
    switch (tok.type) {
      case "NUMBER":
        this.advance();
        return { type: "Num", value: tok.value, line: tok.line };
      case "STRING":
        this.advance();
        return { type: "Str", value: tok.value, line: tok.line };
      case "True":
        this.advance();
        return { type: "BoolLiteral", value: true, line: tok.line };
      case "False":
        this.advance();
        return { type: "BoolLiteral", value: false, line: tok.line };
      case "NAME":
        this.advance();
        return { type: "Name", name: tok.value, line: tok.line };
      case "(": {
        this.advance();
        const expr = this.parseExpr();
        this.expect(")", "Expected ')' to close the expression.");
        return expr;
      }
      case "[": {
        this.advance();
        const elements = [];
        if (!this.at("]")) {
          elements.push(this.parseExpr());
          while (this.at(",")) {
            this.advance();
            elements.push(this.parseExpr());
          }
        }
        this.expect("]", "Expected ']' to close the list.");
        return { type: "ListLiteral", elements, line: tok.line };
      }
      default:
        throw new BambooSyntaxError(
          `Expected a value but found '${tok.value ?? tok.type}'.`,
          tok.line
        );
    }
  }
}

export function parse(source) {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  return parser.parseProgram();
}

export { BambooSyntaxError };
