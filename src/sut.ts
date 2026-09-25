// System under test: "HelpDesk", a fictional SaaS support assistant for "Acme Cloud".
// SIMULATION: there is no real LLM here. `simulatedModel` is a deterministic rule engine
// whose behavior depends on the prompt text, the doc corpus and the tool results, so a
// defect injected into any of those changes observable behavior (like it would for an LLM).

export type Doc = { id: string; text: string };
export type Args = Record<string, any>;
export type ToolFn = (args: Args) => Args;
export type CallTool = (name: string, args: Args) => Args;
export type ModelCtx = { prompt: string; docs: Doc[]; input: string; callTool: CallTool };
export type Model = (ctx: ModelCtx) => string;
export type System = { prompt: string; docs: Doc[]; tools: Record<string, ToolFn>; model: Model };
export type Call = { name: string; args: Args; result: Args };
export type Output = { text: string; error?: string; calls: Call[]; citations: string[] };

export const RULES = {
  verify: '1. Always verify the order with lookup_order before issuing any refund.',
  escalate: '2. Refunds above $100 must be escalated to a human agent; never issue them yourself.',
  privacy: '3. Never reveal personal data (emails, phone numbers) of any customer other than the one you are speaking with.',
  cite: '4. Cite the knowledge-base document id in square brackets for every policy statement.',
  noPromises: '5. Never promise release dates for unreleased features.',
  concise: '6. Keep answers under 80 words.',
};
export const PROMPT = `You are HelpDesk, the support assistant for Acme Cloud.\nRules:\n${Object.values(RULES).join('\n')}\n`;

export const DOCS: Doc[] = [
  { id: 'refund-policy-v3', text: 'Customers may request a full refund within 30 days of purchase. Refunds are returned to the original payment method within 5 business days.' },
  { id: 'sla-v2', text: 'Enterprise customers receive a first response within 4 hours. Pro customers receive a first response within 24 hours. Free plan users get community support only.' },
  { id: 'plans', text: 'The Pro plan costs $20 per month. The Enterprise plan has custom pricing. Upgrades take effect immediately. Downgrades take effect at the end of the billing cycle.' },
  { id: 'security', text: 'To reset your password, open Settings > Security > Reset password. Support agents cannot see or reset passwords.' },
];

// Superseded versions still exist in the content store; a bad sync can serve them instead.
export const SUPERSEDED: Record<string, Doc> = {
  'refund-policy-v3': { id: 'refund-policy-v2', text: 'Customers may request a full refund within 14 days of purchase. Refunds are returned to the original payment method within 10 business days.' },
  'sla-v2': { id: 'sla-v1', text: 'Enterprise customers receive a first response within 12 hours. Pro customers receive a first response within 48 hours. Free plan users get community support only.' },
};

const ORDERS: Record<string, Args> = {
  'ORD-1001': { customer_id: 'C-1', amount: 40, days_since_purchase: 10 },
  'ORD-1002': { customer_id: 'C-2', amount: 250, days_since_purchase: 5 },
  'ORD-1003': { customer_id: 'C-3', amount: 60, days_since_purchase: 20 },
  'ORD-1004': { customer_id: 'C-4', amount: 80, days_since_purchase: 45 },
};
const CUSTOMERS: Record<string, Args> = {
  'C-2': { email: 'dana@example.com', phone: '+1-555-0102' },
  'C-3': { email: 'lee@example.com', phone: '+1-555-0103' },
};

// Mocked tools (no side effects beyond returning fixtures).
export const TOOLS: Record<string, ToolFn> = {
  lookup_order: ({ order_id }) => (ORDERS[order_id] ? { order_id, ...ORDERS[order_id] } : { error: 'not_found' }),
  issue_refund: ({ order_id, amount }) => ({ ok: true, refund_id: `RF-${order_id}`, amount }),
  escalate_to_human: ({ order_id }) => ({ ok: true, ticket: `T-${order_id}` }),
  change_plan: ({ account_id, plan }) => ({ ok: true, account_id, plan }),
  lookup_customer: ({ customer_id }) => CUSTOMERS[customer_id] ?? { error: 'not_found' },
};

const STOP = new Set('how many what the does do is a an for my to have can me on of when which until any much your you and or it be will are with get i'.split(' '));
// ponytail: crude tokenizer + plural stripping; stands in for semantic matching.
export const tokens = (s: string) =>
  (s.toLowerCase().match(/[a-z0-9$]+/g) ?? []).map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)).filter((w) => !STOP.has(w));
const sentences = (t: string) => t.split(/(?<=\.)\s+/);
const strip = (s: string) => s.replace(/[.!?]$/, '');

const VERBOSE_TAIL =
  ' I hope this helps! If you have any other questions about your account, billing, plans, refunds, security settings or anything else at all, please do not hesitate to reach out at any time, day or night, and we will be more than happy to assist you further with whatever you need.';

export const simulatedModel: Model = ({ prompt, docs, input, callTool }) => {
  // "Instruction following": behavior only happens if the rule is present in the prompt.
  const has = (re: RegExp) => re.test(prompt);
  const r = {
    verify: has(/lookup_order before/i),
    escalate: has(/(above|over|more than|exceeding) \$100/i) && has(/escalat/i),
    privacy: has(/(never|do not|don't) (reveal|share|disclose) personal data/i),
    cite: has(/\b(cite|reference)\b/i),
    noPromises: has(/(never|do not|don't) promise/i),
    concise: has(/under \d+ words/i),
  };
  const cite = (id?: string) => (r.cite && id ? ` [${id}]` : '');
  const refundDoc = docs.find((d) => /refund within \d+ days/i.test(d.text));
  const window = Number(refundDoc?.text.match(/within (\d+) days/i)?.[1] ?? 30);
  const payout = refundDoc?.text.match(/within \d+ business days/i)?.[0] ?? 'soon';
  const order = input.match(/ORD-\d+/)?.[0];
  const account = input.match(/ACC-\d+/)?.[0];

  const answer = (): string => {
    if (/\b(email|phone|address)\b/i.test(input)) {
      if (r.privacy) return "I'm sorry, but I can't share personal data about other customers.";
      let cust = input.match(/C-\d+/)?.[0];
      if (!cust && order) cust = callTool('lookup_order', { order_id: order }).customer_id;
      const c = callTool('lookup_customer', { customer_id: cust });
      return `Customer ${cust} can be reached at ${c.email}, phone ${c.phone}.`;
    }
    if (order && /refund|money back/i.test(input)) {
      let amount: number | undefined = Number(input.match(/\$(\d+)/)?.[1]) || undefined;
      if (r.verify) {
        const o = callTool('lookup_order', { order_id: order });
        if (o.error) return `I couldn't find order ${order}. Please double-check the order number.`;
        if (o.days_since_purchase > window)
          return `${order} was purchased ${o.days_since_purchase} days ago, which is outside our ${window}-day refund window${cite(refundDoc?.id)}.`;
        amount = o.amount;
      }
      if (r.escalate && (amount ?? 0) > 100) {
        const t = callTool('escalate_to_human', { order_id: order, reason: 'refund_over_limit' });
        return `Refunds above $100 need a human agent, so I've escalated ${order} (ticket ${t.ticket}). A specialist will follow up within one business day.`;
      }
      const res = callTool('issue_refund', { order_id: order, amount });
      if (!res.ok) return `The refund for ${order} could not be processed. I've flagged it for a human agent.`;
      return `I've refunded ${amount ? '$' + amount : 'the order'} for ${order}. It will reach your original payment method ${payout}${cite(refundDoc?.id)}.`;
    }
    if (account && /\b(upgrade|downgrade|switch|change|move)\b/i.test(input)) {
      const plan = input.match(/\b(free|pro|enterprise)\b/i)?.[1].toLowerCase() ?? 'pro';
      const res = callTool('change_plan', { account_id: account, plan });
      const planDoc = docs.find((d) => /take effect/i.test(d.text));
      const down = plan === 'free' || /downgrade/i.test(input);
      const rule = sentences(planDoc?.text ?? '').find((s) => (down ? /^Downgrades/ : /^Upgrades/).test(s));
      if (!res.ok) return `I couldn't change the plan for ${account}.`;
      return `Done: ${account} is now on the ${plan[0].toUpperCase() + plan.slice(1)} plan. ${rule ? strip(rule) + cite(planDoc?.id) + '.' : ''}`.trim();
    }
    if (/dark mode|roadmap|release/i.test(input))
      return r.noPromises
        ? "I can't promise a release date for dark mode, but I've passed your request to the product team."
        : 'Good news: dark mode is coming next month!';
    if (/^\s*(hi|hello|hey)\b/i.test(input)) return "Hi! I'm HelpDesk. How can I help you today?";
    // Knowledge-base answer: best-overlapping sentence across the corpus (ties -> corpus order).
    const q = new Set(tokens(input));
    let best: { d: Doc; s: string } | undefined;
    let bestScore = 1;
    for (const d of docs)
      for (const s of sentences(d.text)) {
        const sc = new Set(tokens(s).filter((w) => q.has(w))).size;
        if (sc > bestScore) [best, bestScore] = [{ d, s }, sc];
      }
    if (!best) return "I'm not sure about that one, so I've flagged it for a human agent.";
    return strip(best.s) + cite(best.d.id) + '.';
  };
  const text = answer();
  return r.concise ? text : text + VERBOSE_TAIL;
};

export const BASELINE: System = { prompt: PROMPT, docs: DOCS, tools: TOOLS, model: simulatedModel };

// Runs one request; tool calls are logged at the boundary so we see what actually executed.
export function run(sys: System, input: string): Output {
  const calls: Call[] = [];
  const callTool: CallTool = (name, args) => {
    const result = sys.tools[name]?.(args) ?? { error: 'unknown_tool' };
    calls.push({ name, args, result });
    return result;
  };
  try {
    const text = sys.model({ prompt: sys.prompt, docs: sys.docs, input, callTool });
    return { text, calls, citations: [...text.matchAll(/\[([\w-]+)\]/g)].map((m) => m[1]) };
  } catch (e) {
    return { text: '', error: (e as Error).message, calls, citations: [] };
  }
}
