export interface MathSymbol {
  /** LaTeX inserted at the cursor. */
  insert: string;
  /** Glyph shown in the panel button. */
  glyph: string;
  /** Cursor offset inside the inserted text; default: at the end. */
  cursorOffset?: number;
  /** Human-readable name for the tooltip (defaults to the LaTeX code). */
  label?: string;
}

export interface MathSymbolCategory {
  id: string;
  name: string;
  symbols: MathSymbol[];
}

const greek = (glyph: string, insert: string): MathSymbol => ({ glyph, insert });

/** Construct from a template where "|" marks where the cursor lands. */
const construct = (glyph: string, template: string, label: string): MathSymbol => {
  const at = template.indexOf("|");
  const insert = template.split("|").join("");
  return { glyph, insert, cursorOffset: at === -1 ? undefined : at, label };
};

export const MATH_SYMBOL_CATEGORIES: MathSymbolCategory[] = [
  {
    id: "greek-lower",
    name: "Greek",
    symbols: [
      greek("α", "\\alpha"),
      greek("β", "\\beta"),
      greek("γ", "\\gamma"),
      greek("δ", "\\delta"),
      greek("ϵ", "\\epsilon"),
      greek("ε", "\\varepsilon"),
      greek("ζ", "\\zeta"),
      greek("η", "\\eta"),
      greek("θ", "\\theta"),
      greek("ι", "\\iota"),
      greek("κ", "\\kappa"),
      greek("λ", "\\lambda"),
      greek("μ", "\\mu"),
      greek("ν", "\\nu"),
      greek("ξ", "\\xi"),
      greek("π", "\\pi"),
      greek("ρ", "\\rho"),
      greek("σ", "\\sigma"),
      greek("τ", "\\tau"),
      greek("υ", "\\upsilon"),
      greek("φ", "\\phi"),
      greek("ϕ", "\\varphi"),
      greek("χ", "\\chi"),
      greek("ψ", "\\psi"),
      greek("ω", "\\omega"),
    ],
  },
  {
    id: "greek-upper",
    name: "Greek (capital)",
    symbols: [
      greek("Γ", "\\Gamma"),
      greek("Δ", "\\Delta"),
      greek("Θ", "\\Theta"),
      greek("Λ", "\\Lambda"),
      greek("Ξ", "\\Xi"),
      greek("Π", "\\Pi"),
      greek("Σ", "\\Sigma"),
      greek("Υ", "\\Upsilon"),
      greek("Φ", "\\Phi"),
      greek("Ψ", "\\Psi"),
      greek("Ω", "\\Omega"),
    ],
  },
  {
    id: "operators",
    name: "Operators",
    symbols: [
      greek("±", "\\pm"),
      greek("∓", "\\mp"),
      greek("×", "\\times"),
      greek("÷", "\\div"),
      greek("⋅", "\\cdot"),
      greek("∗", "\\ast"),
      greek("⋆", "\\star"),
      greek("∘", "\\circ"),
      greek("⊕", "\\oplus"),
      greek("⊖", "\\ominus"),
      greek("⊗", "\\otimes"),
      greek("⊙", "\\odot"),
      greek("∪", "\\cup"),
      greek("∩", "\\cap"),
      greek("∖", "\\setminus"),
      greek("⋄", "\\diamond"),
    ],
  },
  {
    id: "relations",
    name: "Relations",
    symbols: [
      greek("≤", "\\leq"),
      greek("≥", "\\geq"),
      greek("≠", "\\neq"),
      greek("≈", "\\approx"),
      greek("≡", "\\equiv"),
      greek("∼", "\\sim"),
      greek("∝", "\\propto"),
      greek("≪", "\\ll"),
      greek("≫", "\\gg"),
      greek("∈", "\\in"),
      greek("∉", "\\notin"),
      greek("⊂", "\\subset"),
      greek("⊆", "\\subseteq"),
      greek("⊃", "\\supset"),
      greek("⊇", "\\supseteq"),
      greek("≅", "\\cong"),
    ],
  },
  {
    id: "arrows",
    name: "Arrows",
    symbols: [
      greek("←", "\\leftarrow"),
      greek("→", "\\rightarrow"),
      greek("↔", "\\leftrightarrow"),
      greek("⇐", "\\Leftarrow"),
      greek("⇒", "\\Rightarrow"),
      greek("⇔", "\\Leftrightarrow"),
      greek("↦", "\\mapsto"),
      greek("↑", "\\uparrow"),
      greek("↓", "\\downarrow"),
      greek("⇌", "\\rightleftharpoons"),
    ],
  },
  {
    id: "logic",
    name: "Logic",
    symbols: [
      greek("∀", "\\forall"),
      greek("∃", "\\exists"),
      greek("¬", "\\neg"),
      greek("∧", "\\land"),
      greek("∨", "\\lor"),
      greek("⊢", "\\vdash"),
      greek("⊨", "\\models"),
      greek("⇒", "\\implies"),
      greek("⟺", "\\iff"),
      greek("∴", "\\therefore"),
      greek("∵", "\\because"),
    ],
  },
  {
    id: "calculus",
    name: "Calculus",
    symbols: [
      greek("∑", "\\sum"),
      greek("∏", "\\prod"),
      greek("∫", "\\int"),
      greek("∮", "\\oint"),
      greek("∬", "\\iint"),
      greek("∂", "\\partial"),
      greek("∇", "\\nabla"),
      greek("∞", "\\infty"),
      greek("∅", "\\emptyset"),
      construct("∑ᵢ", "\\sum_{|}^{}", "sum with limits"),
      construct("∫ᵃ", "\\int_{|}^{}", "integral with limits"),
      construct("lim", "\\lim_{|}", "limit"),
    ],
  },
  {
    id: "constructs",
    name: "Constructs",
    symbols: [
      construct("a⁄b", "\\frac{|}{}", "fraction"),
      construct("√", "\\sqrt{|}", "square root"),
      construct("√ⁿ", "\\sqrt[|]{}", "n-th root"),
      construct("x̄", "\\bar{|}", "bar"),
      construct("x⃗", "\\vec{|}", "vector"),
      construct("x̂", "\\hat{|}", "hat"),
      construct("x̃", "\\tilde{|}", "tilde"),
      construct("‾", "\\overline{|}", "overline"),
      construct("＿", "\\underline{|}", "underline"),
      construct("n k", "\\binom{|}{}", "binomial"),
      construct("ℝ", "\\mathbb{|}", "blackboard"),
      construct("𝒳", "\\mathcal{|}", "calligraphic"),
      construct("x", "\\mathrm{|}", "roman"),
    ],
  },
];
