import type { SafetyCategory } from "../types.js";

type PatternRule = {
  category: SafetyCategory;
  label: string;
  pattern: RegExp;
};

const RULES: PatternRule[] = [
  { category: "self-harm", label: "commit suicide", pattern: /\b(commit|committing)\s+suicide\b/i },
  { category: "self-harm", label: "how to kill myself", pattern: /\bhow\s+to\s+kill\s+myself\b/i },
  { category: "self-harm", label: "want to die", pattern: /\b(i\s+)?want\s+to\s+die\b/i },
  { category: "self-harm", label: "self harm", pattern: /\bself[-\s]?harm\b/i },
  { category: "violence", label: "how to hurt someone", pattern: /\bhow\s+to\s+(hurt|kill|stab|shoot|poison)\s+(someone|anyone|people|a\s+person)\b/i },
  { category: "violence", label: "kill someone", pattern: /\bkill\s+(him|her|them|someone|anyone|people)\b/i },
  { category: "violence", label: "hurt someone", pattern: /\bhurt\s+(him|her|them|someone|anyone|people)\b/i },
  { category: "violence", label: "murder", pattern: /\bmurder\b/i }
];

export type GuardrailResult = {
  blocked: boolean;
  category?: SafetyCategory;
  matched: string[];
};

export const detectGuardrailViolation = (message: string): GuardrailResult => {
  const matchedRules = RULES.filter((rule) => rule.pattern.test(message));
  if (matchedRules.length === 0) {
    return {
      blocked: false,
      matched: []
    };
  }

  const category = matchedRules.some((rule) => rule.category === "self-harm") ? "self-harm" : "violence";

  return {
    blocked: true,
    category,
    matched: matchedRules.map((rule) => rule.label)
  };
};
