export const CLASSIFIER_VERSION = "keyword-v1";

export type MessageClass = "buying_signal" | "inquiry" | "payment_related" | "casual_noise" | "manual_review";

export type Classification = {
  label: MessageClass;
  confidence: number;
  ruleIds: string[];
  version: string;
};

export interface MessageClassifier {
  classify(input: { text: string; mediaType: string; manualReview: boolean }): Classification;
}

type Rule = { id: string; pattern: RegExp; confidence: number };
type RuleMatch = Omit<Classification, "label">;

// Rules require explicit commercial language. The default is noise because a
// false buying signal costs seller trust while a missed signal creates no new harm.
const buyingRules: Rule[] = [
  { id: "buy.how_much", pattern: /\bhow\s+much(?:\s+(?:is|for|be|this|it|that|one)\b|\s*[?!.]*$)/i, confidence: 0.97 },
  { id: "buy.price_request", pattern: /\b(?:what(?:'s|\s+is)\s+(?:the\s+)?price|price\s+(?:for\s+)?(?:this|it|that|one)|send\s+(?:me\s+)?(?:the\s+)?price)\b/i, confidence: 0.96 },
  { id: "buy.availability", pattern: /\b(?:is\s+(?:this|it|that)\s+(?:still\s+)?available|do\s+you\s+still\s+have\s+(?:this|it|that))\b/i, confidence: 0.95 },
  { id: "buy.explicit_order", pattern: /\b(?:i\s+(?:want|need)\s+(?:to\s+buy|to\s+order|this|one)|can\s+i\s+(?:buy|order|get)\s+(?:this|one)|how\s+(?:do|can)\s+i\s+order)\b/i, confidence: 0.98 },
  { id: "buy.pidgin", pattern: /\b(?:how\s+much\s+(?:e|this)\s+be|i\s+wan\s+(?:buy|order|collect)|make\s+i\s+(?:buy|order)|i\s+go\s+buy)\b/i, confidence: 0.97 },
  { id: "buy.yoruba", pattern: /(?:^|\s)(?:elo\s+ni|mo\s+fe\s+ra|mo\s+fẹ́?\s+rà)(?=\s|[?.!,]|$)/iu, confidence: 0.96 },
  { id: "buy.igbo", pattern: /(?:^|\s)(?:ego\s+ole|achoro\s+izu|achọrọ\s+ịzụ)(?=\s|[?.!,]|$)/iu, confidence: 0.96 },
];

const paymentRules: Rule[] = [
  { id: "payment.account", pattern: /\b(?:send\s+(?:me\s+)?(?:your\s+)?account(?:\s+number)?|account\s+(?:details|number))\b/i, confidence: 0.98 },
  { id: "payment.transfer", pattern: /\b(?:i\s+(?:have|'ve)\s+(?:paid|transferred)|payment\s+(?:done|sent)|transfer\s+(?:done|sent)|proof\s+of\s+payment)\b/i, confidence: 0.98 },
  { id: "payment.problem", pattern: /\b(?:payment\s+(?:failed|pending)|transfer\s+(?:failed|pending)|debit(?:ed)?\s+but)\b/i, confidence: 0.96 },
];

const inquiryRules: Rule[] = [
  { id: "inquiry.stock", pattern: /\b(?:do\s+you\s+have|what\s+(?:sizes?|colou?rs?)|which\s+(?:sizes?|colou?rs?))\b/i, confidence: 0.91 },
  { id: "inquiry.delivery", pattern: /\b(?:do\s+you\s+deliver|delivery\s+(?:fee|cost|time)|where\s+are\s+you\s+located|what\s+is\s+your\s+location)\b/i, confidence: 0.92 },
  { id: "inquiry.details", pattern: /\b(?:tell\s+me\s+more|more\s+details|what\s+does\s+it\s+come\s+with)\b/i, confidence: 0.9 },
];

function normalize(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("en").replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
}

function matchRules(text: string, rules: Rule[]): RuleMatch | null {
  const matches = rules.filter((rule) => rule.pattern.test(text));
  if (matches.length === 0) return null;
  return {
    confidence: Math.max(...matches.map((rule) => rule.confidence)),
    ruleIds: matches.map((rule) => rule.id),
    version: CLASSIFIER_VERSION,
  };
}

export const keywordClassifier: MessageClassifier = {
  classify(input) {
    if (input.manualReview || input.mediaType !== "text") {
      return { label: "manual_review", confidence: 1, ruleIds: ["manual.non_text_or_shortened"], version: CLASSIFIER_VERSION };
    }
    const text = normalize(input.text);
    if (!text) return { label: "casual_noise", confidence: 1, ruleIds: ["noise.empty"], version: CLASSIFIER_VERSION };
    const payment = matchRules(text, paymentRules);
    if (payment) return { ...payment, label: "payment_related" };
    const buying = matchRules(text, buyingRules);
    if (buying) return { ...buying, label: "buying_signal" };
    const inquiry = matchRules(text, inquiryRules);
    if (inquiry) return { ...inquiry, label: "inquiry" };
    return { label: "casual_noise", confidence: 0.9, ruleIds: ["noise.default"], version: CLASSIFIER_VERSION };
  },
};

export type LabeledExample = { text: string; label: MessageClass; mediaType?: string; manualReview?: boolean };

export function evaluateClassifier(examples: LabeledExample[], classifier: MessageClassifier = keywordClassifier) {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let correct = 0;
  const rows = examples.map((example) => {
    const prediction = classifier.classify({ text: example.text, mediaType: example.mediaType ?? "text", manualReview: example.manualReview ?? false });
    const expectedPositive = example.label === "buying_signal";
    const predictedPositive = prediction.label === "buying_signal";
    if (expectedPositive && predictedPositive) truePositive++;
    if (!expectedPositive && predictedPositive) falsePositive++;
    if (expectedPositive && !predictedPositive) falseNegative++;
    if (prediction.label === example.label) correct++;
    return { ...example, prediction: prediction.label, version: prediction.version, ruleIds: prediction.ruleIds };
  });
  const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
  const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
  const f1 = precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
  return { version: CLASSIFIER_VERSION, samples: examples.length, truePositive, falsePositive, falseNegative, precision, recall, f1, accuracy: examples.length === 0 ? 0 : correct / examples.length, rows };
}
