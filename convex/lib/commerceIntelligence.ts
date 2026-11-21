export type CommitmentCandidate = {
  actor: "customer" | "business";
  kind: "follow_up" | "stock_check" | "price_check" | "payment" | "delivery" | "refund" | "replacement" | "appointment" | "other";
  summary: string;
  dueAt?: number;
  confidence: number;
};

export type ExceptionCandidate = {
  kind: "complaint" | "delay" | "out_of_stock" | "payment_failure" | "wrong_item" | "damaged_item" | "refund" | "return" | "warranty" | "delivery_fee" | "incorrect_information" | "other";
  severity: "low" | "normal" | "high" | "critical";
  summary: string;
  ownerQuestion?: string;
};

const DAY = 86_400_000;

function clean(value: string, maximum = 500): string {
  return value.replaceAll("\u0000", "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function inferredDueAt(text: string, eventAt: number): number | undefined {
  if (/\b(today|this evening|tonight|before close|before closing)\b/i.test(text)) return eventAt + 8 * 3_600_000;
  if (/\b(tomorrow|tmrw|2moro)\b/i.test(text)) return eventAt + DAY;
  if (/\b(next week)\b/i.test(text)) return eventAt + 7 * DAY;
  const days = /\b(?:in|within)\s+(\d{1,2})\s+days?\b/i.exec(text);
  if (days) return eventAt + Math.min(30, Number(days[1])) * DAY;
  const hours = /\b(?:in|within)\s+(\d{1,2})\s+hours?\b/i.exec(text);
  if (hours) return eventAt + Math.min(72, Number(hours[1])) * 3_600_000;
  return undefined;
}

export function detectCommitment(content: string, role: "customer" | "owner", eventAt: number): CommitmentCandidate | null {
  const text = clean(content);
  if (!text) return null;
  const lower = text.toLowerCase();
  const actor = role === "owner" ? "business" : "customer";
  const patterns: Array<[CommitmentCandidate["kind"], RegExp]> = [
    ["payment", /\b(i(?:'ll| will| go) pay|send (?:the )?(?:account|payment details)|make (?:the )?payment|payment tomorrow|transfer)\b/i],
    ["stock_check", /\b(check (?:the )?stock|confirm (?:availability|stock)|see if (?:it|this) is available)\b/i],
    ["price_check", /\b(confirm (?:the )?price|check (?:the )?price|get back .*price|send .*price)\b/i],
    ["delivery", /\b(deliver|delivery|ship|waybill|dispatch|send it (?:today|tomorrow|on))\b/i],
    ["refund", /\b(refund|return your money|send (?:the )?money back)\b/i],
    ["replacement", /\b(replace|replacement|exchange)\b/i],
    ["appointment", /\b(book|schedule|appointment|call you|meet)\b/i],
    ["follow_up", /\b(i(?:'ll| will| go) (?:confirm|check|reply|get back|update|message|call)|let me (?:confirm|check)|we(?:'ll| will) (?:confirm|reply|update))\b/i],
  ];
  const match = patterns.find(([, pattern]) => pattern.test(lower));
  if (!match) return null;
  return { actor, kind: match[0], summary: text, dueAt: inferredDueAt(text, eventAt), confidence: match[0] === "follow_up" ? 0.78 : 0.86 };
}

export function detectException(content: string): ExceptionCandidate | null {
  const text = clean(content);
  if (!text) return null;
  const lower = text.toLowerCase();
  const critical = /\b(scam|fraud|police|lawyer|chargeback|stolen|threat|unsafe|injur(?:y|ed))\b/i.test(lower);
  const high = critical || /\b(very angry|unacceptable|urgent|immediately|never arrived|still no refund|wrong order)\b/i.test(lower);
  const definitions: Array<[ExceptionCandidate["kind"], RegExp, string]> = [
    ["damaged_item", /\b(damaged|broken|torn|spoilt|defective|not working)\b/i, "The customer says the item arrived damaged or is not working."],
    ["wrong_item", /\b(wrong item|wrong size|wrong colour|wrong color|not what i ordered)\b/i, "The customer says the order does not match what they requested."],
    ["delay", /\b(delayed|late|not arrived|never arrived|where is my order|still waiting)\b/i, "The customer is waiting for an order or service that has not arrived on time."],
    ["refund", /\b(refund|money back|return my money|still no refund)\b/i, "The customer is requesting or waiting for a refund."],
    ["return", /\b(return (?:it|this|the item)|send it back)\b/i, "The customer wants to return an item."],
    ["payment_failure", /\b(payment failed|debited but|transfer failed|paid but|payment not reflecting|payment not received)\b/i, "There is a payment discrepancy that needs verification."],
    ["out_of_stock", /\b(out of stock|not available|sold out|no longer available)\b/i, "The requested item may not be available."],
    ["delivery_fee", /\b(delivery fee|delivery charge|shipping fee|waybill fee)\b/i, "The customer disputes or needs approval for the delivery charge."],
    ["warranty", /\b(warranty|guarantee|repair)\b/i, "The customer is asking for warranty or repair support."],
    ["incorrect_information", /\b(you said|you told me|wrong information|different price|misled)\b/i, "The customer says the business previously supplied incorrect or conflicting information."],
    ["complaint", /\b(complain|complaint|angry|disappointed|bad service|terrible|unhappy|problem|issue)\b/i, "The customer has raised a complaint that needs ownership."],
  ];
  const match = definitions.find(([, pattern]) => pattern.test(lower));
  if (!match) return null;
  const severity = critical ? "critical" : high ? "high" : match[0] === "complaint" || match[0] === "refund" || match[0] === "wrong_item" || match[0] === "damaged_item" ? "normal" : "low";
  return {
    kind: match[0], severity, summary: match[2],
    ownerQuestion: severity === "critical" || ["refund", "incorrect_information", "delivery_fee"].includes(match[0])
      ? `How should Pipelixr resolve this ${match[0].replaceAll("_", " ")} request?`
      : undefined,
  };
}

export function detectMemoryCandidates(content: string): Array<{ key: string; value: string; category: "preference" | "identity" | "purchase" | "delivery" | "support" | "relationship"; confidence: number }> {
  const text = clean(content, 1_000);
  const candidates: Array<{ key: string; value: string; category: "preference" | "identity" | "purchase" | "delivery" | "support" | "relationship"; confidence: number }> = [];
  const size = /\b(?:my size is\s*|i wear\s*(?:size\s*)?|size\s*)(\d{1,3}|[a-z]{1,4})\b/i.exec(text);
  if (size) candidates.push({ key: "preferred_size", value: clean(size[1], 30), category: "preference", confidence: 0.88 });
  const colour = /\b(?:i prefer|i want|my colour is|my color is)\s+(black|white|blue|red|green|yellow|pink|purple|brown|grey|gray|orange|gold|silver)\b/i.exec(text);
  if (colour) candidates.push({ key: "preferred_colour", value: colour[1].toLowerCase(), category: "preference", confidence: 0.82 });
  const budget = /(?:budget|i have|i can pay|around|under)\s*(?:is\s*)?(?:₦|ngn|n)?\s*([\d,.]{3,})/i.exec(text);
  if (budget) candidates.push({ key: "budget", value: budget[1].replaceAll(",", ""), category: "preference", confidence: 0.76 });
  const address = /\b(?:deliver to|delivery address is|send it to|my address is)\s+(.{8,160})/i.exec(text);
  if (address) candidates.push({ key: "delivery_address", value: clean(address[1], 180), category: "delivery", confidence: 0.74 });
  return candidates;
}
