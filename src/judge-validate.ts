// npm run judge:validate -> agreement between the heuristic judge and (illustrative) human labels + bias probes.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { judge, judgePair } from './suite';
import { accuracy, cohenKappa, THRESHOLDS } from './score';

const Labels = z.object({
  note: z.string(),
  items: z.array(z.object({ id: z.string(), question: z.string(), reference: z.string(), answer: z.string(), human: z.enum(['pass', 'fail']) })).min(1),
});
const { items } = Labels.parse(JSON.parse(readFileSync(new URL('../data/human-labels.json', import.meta.url), 'utf8')));

const human = items.map((i) => i.human);
const pred = items.map((i) => (judge(i.question, i.answer, i.reference).pass ? 'pass' : 'fail'));
const acc = accuracy(human, pred);
const kappa = cohenKappa(human, pred);
const log: string[] = ['# Judge validation', '', '_Human labels are illustrative, written for this demo (see data/human-labels.json)._', ''];
log.push(`Items: ${items.length}`, `Accuracy: ${(acc * 100).toFixed(1)}%`, `Cohen's kappa: ${kappa.toFixed(3)} (min ${THRESHOLDS.minJudgeKappa})`, '');
log.push('Disagreements:');
items.forEach((i, k) => pred[k] !== human[k] && log.push(`- ${i.id}: human=${human[k]} judge=${pred[k]} (score ${judge(i.question, i.answer, i.reference).score})`));

// Position bias: same pair, swapped order; a consistent judge picks the same answer both times.
const byQ = new Map<string, typeof items>();
for (const i of items) byQ.set(i.question, [...(byQ.get(i.question) ?? []), i]);
let pairs = 0, flips = 0;
for (const [q, [a, b]] of byQ) {
  if (!b) continue;
  pairs++;
  const first = judgePair(q, a.reference, a.answer, b.answer); // 'A' means a
  const swapped = judgePair(q, a.reference, b.answer, a.answer); // 'B' means a
  if ((first === 'A') !== (swapped === 'B')) flips++;
}
log.push('', `Position bias: ${flips}/${pairs} pairs change winner when A/B order is swapped.`);

// Verbosity bias: pad each answer with content-free filler.
const PAD = ' Thank you so much for reaching out to us today; we truly value you as a customer and we are always here to help you with absolutely anything you might need at any time.';
let up = 0, flipToPass = 0;
for (const i of items) {
  const s0 = judge(i.question, i.answer, i.reference), s1 = judge(i.question, i.answer + PAD, i.reference);
  if (s1.score > s0.score) up++;
  if (!s0.pass && s1.pass) flipToPass++;
}
log.push(`Verbosity bias: padding raised the score of ${up}/${items.length} answers; ${flipToPass} flipped fail -> pass.`);
console.log(log.join('\n'));
process.exit(kappa < THRESHOLDS.minJudgeKappa ? 1 : 0);
