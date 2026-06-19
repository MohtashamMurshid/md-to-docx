import {
  Math as DocxMath,
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSuperScript,
} from "docx";
import type { MathComponent } from "docx";

const COMMAND_REPLACEMENTS = new Map<string, string>([
  ["alpha", "α"],
  ["beta", "β"],
  ["gamma", "γ"],
  ["delta", "δ"],
  ["epsilon", "ϵ"],
  ["varepsilon", "ε"],
  ["theta", "θ"],
  ["lambda", "λ"],
  ["mu", "μ"],
  ["pi", "π"],
  ["rho", "ρ"],
  ["sigma", "σ"],
  ["phi", "ϕ"],
  ["varphi", "φ"],
  ["omega", "ω"],
  ["Gamma", "Γ"],
  ["Delta", "Δ"],
  ["Theta", "Θ"],
  ["Lambda", "Λ"],
  ["Pi", "Π"],
  ["Sigma", "Σ"],
  ["Phi", "Φ"],
  ["Omega", "Ω"],
  ["times", "×"],
  ["cdot", "·"],
  ["pm", "±"],
  ["mp", "∓"],
  ["le", "≤"],
  ["leq", "≤"],
  ["ge", "≥"],
  ["geq", "≥"],
  ["neq", "≠"],
  ["approx", "≈"],
  ["infty", "∞"],
  ["sum", "∑"],
  ["int", "∫"],
  ["sin", "sin"],
  ["cos", "cos"],
  ["tan", "tan"],
  ["log", "log"],
  ["ln", "ln"],
]);

type ParseResult =
  | { supported: true; children: MathComponent[] }
  | { supported: false; reason: string };

class MathParseError extends Error {}

class TexMathParser {
  private position = 0;

  constructor(private readonly source: string) {}

  parse(): MathComponent[] {
    const children = this.parseExpression();
    this.skipSpaces();

    if (this.position !== this.source.length) {
      throw new MathParseError(
        `Unexpected token '${this.source[this.position]}' at ${this.position}`,
      );
    }

    if (children.length === 0) {
      throw new MathParseError("Math expression is empty");
    }

    return children;
  }

  private parseExpression(stopCharacter?: string): MathComponent[] {
    const children: MathComponent[] = [];

    while (this.position < this.source.length) {
      if (stopCharacter && this.source[this.position] === stopCharacter) {
        break;
      }

      children.push(this.parseAtomWithScripts());
    }

    return children;
  }

  private parseAtomWithScripts(): MathComponent {
    let base = this.parseAtom();
    let subScript: MathComponent[] | undefined;
    let superScript: MathComponent[] | undefined;

    while (this.source[this.position] === "_" || this.source[this.position] === "^") {
      const marker = this.source[this.position];
      this.position++;
      const value = this.parseScriptArgument();

      if (marker === "_") {
        if (subScript) {
          throw new MathParseError("Duplicate subscript");
        }
        subScript = value;
      } else {
        if (superScript) {
          throw new MathParseError("Duplicate superscript");
        }
        superScript = value;
      }
    }

    if (subScript && superScript) {
      base = new MathSubSuperScript({
        children: [base],
        subScript,
        superScript,
      });
    } else if (subScript) {
      base = new MathSubScript({ children: [base], subScript });
    } else if (superScript) {
      base = new MathSuperScript({ children: [base], superScript });
    }

    return base;
  }

  private parseAtom(): MathComponent {
    if (this.position >= this.source.length) {
      throw new MathParseError("Expected math token");
    }

    const character = this.source[this.position];
    if (character === "\\") {
      return this.parseCommand();
    }

    if (character === "{") {
      throw new MathParseError("Unexpected group");
    }

    if (character === "}") {
      throw new MathParseError("Unexpected closing group");
    }

    if (character === "_" || character === "^") {
      throw new MathParseError(`Missing base before '${character}'`);
    }

    this.position++;
    return new MathRun(character);
  }

  private parseCommand(): MathComponent {
    this.position++;
    const start = this.position;

    while (/[A-Za-z]/.test(this.source[this.position] || "")) {
      this.position++;
    }

    if (start === this.position) {
      const escaped = this.source[this.position];
      if (!escaped) {
        throw new MathParseError("Trailing escape");
      }
      this.position++;
      return new MathRun(escaped);
    }

    const command = this.source.slice(start, this.position);
    if (command === "frac") {
      return new MathFraction({
        numerator: this.parseRequiredGroup("fraction numerator"),
        denominator: this.parseRequiredGroup("fraction denominator"),
      });
    }

    if (command === "sqrt") {
      if (this.source[this.position] === "[") {
        throw new MathParseError("Root degree syntax is not supported");
      }
      return new MathRadical({
        children: this.parseRequiredGroup("square root body"),
      });
    }

    const replacement = COMMAND_REPLACEMENTS.get(command);
    if (!replacement) {
      throw new MathParseError(`Unsupported command \\${command}`);
    }

    return new MathRun(replacement);
  }

  private parseRequiredGroup(label: string): MathComponent[] {
    this.skipSpaces();

    if (this.source[this.position] !== "{") {
      throw new MathParseError(`Expected ${label}`);
    }

    this.position++;
    const children = this.parseExpression("}");

    if (this.source[this.position] !== "}") {
      throw new MathParseError(`Unclosed ${label}`);
    }

    this.position++;

    if (children.length === 0) {
      throw new MathParseError(`${label} is empty`);
    }

    return children;
  }

  private parseScriptArgument(): MathComponent[] {
    if (this.source[this.position] === "{") {
      return this.parseRequiredGroup("script");
    }

    return [this.parseAtom()];
  }

  private skipSpaces(): void {
    while (/\s/.test(this.source[this.position] || "")) {
      this.position++;
    }
  }
}

export function parseTexMath(source: string): ParseResult {
  try {
    return {
      supported: true,
      children: new TexMathParser(source.trim()).parse(),
    };
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : "Unsupported math",
    };
  }
}

export function renderNativeMath(children: MathComponent[]): DocxMath {
  return new DocxMath({ children });
}
