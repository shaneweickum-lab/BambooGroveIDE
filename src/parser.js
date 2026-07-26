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
      body.push(this.at("def") ? this.parseFunctionDef() : this.parseTopLevelStatement());
      this.skipNewlines();
    }
    return { type: "Program", body };
  }

  // Top-level statements do double duty: in Canvas mode they're read as
  // variable initializers shared across every function (setup/draw/event
  // callbacks) — the BambooScript equivalent of a Python module's global
  // scope, or a p5.js sketch's top-of-file `let`s. In Terminal mode (spec
  // 3.6 Terminal tab) the SAME grammar is a plain top-to-bottom script, so
  // full control flow (if/for/while) is allowed here too. `return` still
  // doesn't make sense outside a function in either mode. `import`/`from`
  // (spec section 6) are only meaningful at the top level as well.
  parseTopLevelStatement() {
    const tok = this.peek();
    if (tok.type === "return") {
      throw new BambooSyntaxError(
        "'return' can only be used inside a function.",
        tok.line
      );
    }
    if (tok.type === "import") return this.parseImport();
    if (tok.type === "from") return this.parseFromImport();
    return this.parseStatement();
  }

  parseImport() {
    const tok = this.expect("import");
    const nameTok = this.expect("NAME", "Expected a module name after 'import'.");
    this.expect("NEWLINE", "Expected end of line.");
    return { type: "Import", module: nameTok.value, line: tok.line };
  }

  parseFromImport() {
    const tok = this.expect("from");
    const moduleTok = this.expect("NAME", "Expected a module name after 'from'.");
    this.expect("import", "Expected 'import' after the module name.");
    const names = [this.parseImportName()];
    while (this.at(",")) {
      this.advance();
      names.push(this.parseImportName());
    }
    this.expect("NEWLINE", "Expected end of line.");
    return { type: "FromImport", module: moduleTok.value, names, line: tok.line };
  }

  parseImportName() {
    const nameTok = this.expect("NAME", "Expected a name to import.");
    let alias = null;
    if (this.at("as")) {
      this.advance();
      alias = this.expect("NAME", "Expected a name after 'as'.").value;
    }
    return { name: nameTok.value, alias };
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
      case "try":
        return this.parseTry();
      case "import":
      case "from":
        throw new BambooSyntaxError(
          "Imports can only appear at the top of the file, not inside a function.",
          this.peek().line
        );
      default:
        return this.parseSimpleStatement();
    }
  }

  parseSimpleStatement() {
    let stmt;
    if (this.at("return")) {
      stmt = this.parseReturn();
    } else if (this.at("raise")) {
      stmt = this.parseRaise();
    } else {
      stmt = this.parseExprOrAssign();
    }
    this.expect("NEWLINE", "Expected end of line.");
    return stmt;
  }

  parseRaise() {
    const raiseTok = this.expect("raise");
    let value = null;
    if (!this.at("NEWLINE")) {
      value = this.parseExpr();
    }
    return { type: "Raise", value, line: raiseTok.line };
  }

  parseTry() {
    const tryTok = this.expect("try");
    this.expect(":", "Expected ':' after 'try'.");
    const body = this.parseBlock();

    const handlers = [];
    while (this.at("except")) {
      const exceptTok = this.advance();
      let exceptionName = null;
      let bindName = null;
      if (!this.at(":")) {
        exceptionName = this.expect("NAME", "Expected an exception type name after 'except'.").value;
        if (this.at("as")) {
          this.advance();
          bindName = this.expect("NAME", "Expected a name after 'as'.").value;
        }
      }
      this.expect(":", "Expected ':' after the 'except' clause.");
      const handlerBody = this.parseBlock();
      handlers.push({ exceptionName, bindName, body: handlerBody, line: exceptTok.line });
    }

    let orelse = null;
    if (handlers.length > 0 && this.at("else")) {
      this.advance();
      this.expect(":", "Expected ':' after 'else'.");
      orelse = this.parseBlock();
    }

    let finallyBody = null;
    if (this.at("finally")) {
      this.advance();
      this.expect(":", "Expected ':' after 'finally'.");
      finallyBody = this.parseBlock();
    }

    if (handlers.length === 0 && finallyBody === null) {
      throw new BambooSyntaxError(
        "A 'try' block needs at least one 'except' clause or a 'finally' clause.",
        tryTok.line
      );
    }

    return { type: "Try", body, handlers, orelse, finallyBody, line: tryTok.line };
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
      if (expr.type !== "Name" && expr.type !== "Index" && expr.type !== "Attribute") {
        throw new BambooSyntaxError("Left-hand side of '=' must be a variable, list index, or .attribute.", line);
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
    if (this.at("in")) {
      const tok = this.advance();
      const right = this.parseArith();
      left = { type: "Compare", op: "in", left, right, line: tok.line };
    } else if (this.at("not") && this.peek(1).type === "in") {
      const tok = this.advance();
      this.advance(); // consume the paired 'in'
      const right = this.parseArith();
      left = { type: "Compare", op: "not in", left, right, line: tok.line };
    } else if (COMPARE_OPS.has(this.peek().type)) {
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
    while (this.at("*") || this.at("/") || this.at("//") || this.at("%")) {
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
      if (this.at(".")) {
        // `.name` — attribute access. Used for an imported sibling file's
        // functions (spec section 6: `panda.draw_panda()`) and for objects
        // with their own fields/methods, like Vector (`v.x`, `v.add(...)`).
        const dotTok = this.advance();
        const nameTok = this.expect("NAME", "Expected a name after '.'.");
        node = { type: "Attribute", object: node, name: nameTok.value, line: dotTok.line };
      } else if (this.at("(")) {
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
        if (node.type === "Name") {
          node = { type: "Call", callee: node.name, args, line: tok.line };
        } else if (node.type === "Attribute") {
          node = { type: "MethodCall", object: node.object, method: node.name, args, line: tok.line };
        } else {
          throw new BambooSyntaxError("Only a plain name or a.b(...) can be called.", tok.line);
        }
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
        return { type: "Num", value: tok.value, isFloat: tok.isFloat, line: tok.line };
      case "STRING":
        this.advance();
        return { type: "Str", value: tok.value, line: tok.line };
      case "FSTRING": {
        this.advance();
        const parts = tok.value.map((part) =>
          part.type === "text"
            ? { type: "text", value: part.value }
            : { type: "expr", expr: this.parseFStringExpr(part.source, part.line), spec: part.spec }
        );
        return { type: "FString", parts, line: tok.line };
      }
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

  // An f-string's `{...}` holds a nested BambooScript expression — tokenize
  // and parse that fragment on its own, then make sure nothing but the
  // implicit trailing NEWLINE/EOF is left over (catches things like
  // `{1 2}` that parse a prefix and silently ignore the rest).
  parseFStringExpr(source, line) {
    let expr;
    try {
      const innerTokens = tokenize(source);
      const innerParser = new Parser(innerTokens);
      expr = innerParser.parseExpr();
      if (!(innerParser.at("NEWLINE") && innerParser.peek(1).type === "EOF")) {
        throw new BambooSyntaxError("unexpected extra content.", line);
      }
    } catch (err) {
      throw new BambooSyntaxError(
        `Invalid expression inside f-string '{${source}}': ${err.message}`,
        line
      );
    }
    return expr;
  }
}

export function parse(source) {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  return parser.parseProgram();
}

export { BambooSyntaxError };
