import { describe, expect, it } from "vitest";
import { evaluateClassifier, keywordClassifier, type LabeledExample } from "../convex/lib/classifier";

describe("keyword classifier", () => {
  it.each([
    ["How much for this one?", "buying_signal"],
    ["I wan buy this", "buying_signal"],
    ["Elo ni?", "buying_signal"],
    ["Achọrọ ịzụ", "buying_signal"],
    ["Do you deliver to Abuja?", "inquiry"],
    ["Send me your account number", "payment_related"],
    ["Payment pending", "payment_related"],
    ["How are you?", "casual_noise"],
    ["Good morning", "casual_noise"],
    ["Thanks 🙏", "casual_noise"],
    ["The price of fuel is high", "casual_noise"],
  ] as const)("classifies %s as %s", (text, expected) => {
    expect(keywordClassifier.classify({ text, mediaType: "text", manualReview: false }).label).toBe(expected);
  });

  it("flags non-text or shortened content for manual review", () => {
    expect(keywordClassifier.classify({ text: "", mediaType: "audio", manualReview: true }).label).toBe("manual_review");
  });

  it("reports buying-signal precision and recall against a labeled set", () => {
    const examples: LabeledExample[] = [
      { text: "How much for this one?", label: "buying_signal" },
      { text: "I want this", label: "buying_signal" },
      { text: "Do you deliver?", label: "inquiry" },
      { text: "How much joy can one person have?", label: "casual_noise" },
    ];
    const result = evaluateClassifier(examples);
    expect(result).toMatchObject({ samples: 4, truePositive: 2, falsePositive: 0, falseNegative: 0, precision: 1, recall: 1, f1: 1 });
  });
});
