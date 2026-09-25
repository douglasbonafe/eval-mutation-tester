// Mutators: each one injects a single controlled change into the system under test.
// kind 'defect' should be caught by the suite; kind 'benign' should NOT (false alarm if it is).
import { RULES, SUPERSEDED, type CallTool, type System } from './sut';

export type Mutator = { name: string; family: string; kind: 'defect' | 'benign'; apply: (s: System) => System };

const removeLine = (s: System, line: string): System => {
  if (!s.prompt.includes(line)) throw new Error(`mutator no-op: rule not in prompt: ${line}`); // guard vs equivalent mutants
  return { ...s, prompt: s.prompt.replace(line + '\n', '') };
};
const wrapText = (s: System, f: (t: string) => string): System => ({ ...s, model: (ctx) => f(s.model(ctx)) });
const wrapCalls = (s: System, f: (call: CallTool) => CallTool): System => ({ ...s, model: (ctx) => s.model({ ...ctx, callTool: f(ctx.callTool) }) });
const ACTIONS = new Set(['issue_refund', 'change_plan', 'escalate_to_human']);
const SYNONYMS: [RegExp, string][] = [[/\bNever\b/g, 'Do not'], [/\bnever\b/g, 'do not'], [/\bmust\b/g, 'have to'], [/\bAlways\b/g, 'Make sure to'], [/\babove\b/g, 'over'], [/\bCite\b/g, 'Reference'], [/\bcustomer\b/g, 'client']];

export const MUTATORS: Mutator[] = [
  // 1. remove an important rule from the prompt (one mutant per rule)
  ...Object.entries(RULES).map(([k, line]): Mutator => ({ name: `remove-rule:${k}`, family: 'remove rule', kind: 'defect', apply: (s) => removeLine(s, line) })),
  // 2. serve the superseded version of a doc
  ...Object.entries(SUPERSEDED).map(([id, old]): Mutator => ({
    name: `superseded-doc:${id}->${old.id}`, family: 'superseded doc', kind: 'defect',
    apply: (s) => ({ ...s, docs: s.docs.map((d) => (d.id === id ? old : d)) }),
  })),
  // 3. inject a citation to a doc that does not exist
  { name: 'fake-citation', family: 'non-existent citation', kind: 'defect', apply: (s) => wrapText(s, (t) => t.replace(/([.!?])$/, ' [kb-legacy-2019]$1')) },
  // 4. alter a tool call argument on its way to the tool
  { name: 'tool-arg:refund-amount-x10', family: 'altered tool arg', kind: 'defect', apply: (s) => wrapCalls(s, (call) => (n, a) => call(n, n === 'issue_refund' ? { ...a, amount: a.amount * 10 } : a)) },
  { name: 'tool-arg:wrong-account-id', family: 'altered tool arg', kind: 'defect', apply: (s) => wrapCalls(s, (call) => (n, a) => call(n, n === 'change_plan' ? { ...a, account_id: a.account_id + '0' } : a)) },
  // 5. truncated response / timeout
  { name: 'truncated-response', family: 'truncation/timeout', kind: 'defect', apply: (s) => wrapText(s, (t) => t.slice(0, Math.ceil(t.length * 0.6))) },
  {
    name: 'timeout:every-3rd-request', family: 'truncation/timeout', kind: 'defect',
    apply: (s) => {
      let n = 0;
      return { ...s, model: (ctx) => { if (++n % 3 === 0) throw new Error('model timeout after 30s'); return s.model(ctx); } };
    },
  },
  // 6. agent claims success without executing the action (action tools are silently skipped)
  { name: 'success-without-action', family: 'fake success', kind: 'defect', apply: (s) => wrapCalls(s, (call) => (n, a) => (ACTIONS.has(n) ? { ok: true, ticket: 'T-PENDING' } : call(n, a))) },

  // Benign: must not change behavior; any kill here is a false alarm.
  { name: 'benign:reformat-prompt', family: 'benign', kind: 'benign', apply: (s) => ({ ...s, prompt: s.prompt.split('\n').map((l) => '   ' + l.trim() + '  ').join('\n\n') }) },
  { name: 'benign:synonym-reword', family: 'benign', kind: 'benign', apply: (s) => ({ ...s, prompt: SYNONYMS.reduce((p, [re, w]) => p.replace(re, w), s.prompt) }) },
  { name: 'benign:reorder-docs', family: 'benign', kind: 'benign', apply: (s) => ({ ...s, docs: [...s.docs].reverse() }) },
];
