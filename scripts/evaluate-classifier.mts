import { readFile } from "node:fs/promises";
import { evaluateClassifier, type LabeledExample } from "../convex/lib/classifier.ts";

const labels = new Set(["buying_signal", "inquiry", "payment_related", "casual_noise", "manual_review"]);

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: npm run classifier:eval -- <labeled-set.json>");
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("The labeled set must be a JSON array.");
  // Runtime validation keeps accidental or malformed exports from producing
  // credible-looking metrics from an invalid dataset.
  const examples = parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || !("text" in entry) || !("label" in entry) || typeof entry.text !== "string" || typeof entry.label !== "string" || !labels.has(entry.label)) throw new Error(`Invalid labeled example at index ${index}.`);
    return entry as LabeledExample;
  });
  const result = evaluateClassifier(examples);
  process.stdout.write(`${JSON.stringify({ version: result.version, samples: result.samples, truePositive: result.truePositive, falsePositive: result.falsePositive, falseNegative: result.falseNegative, precision: result.precision, recall: result.recall, f1: result.f1, accuracy: result.accuracy }, null, 2)}\n`);
}

await main();
