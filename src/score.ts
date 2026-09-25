// Pure scoring + gating. CI thresholds live here.
export const THRESHOLDS = { minMutationScore: 0.8, maxFalseAlarmRate: 0, minJudgeKappa: 0.3 };

export type MutantResult = { name: string; kind: 'defect' | 'benign'; killed: boolean; killedBy: string[] };

export function summarize(results: MutantResult[]) {
  const defects = results.filter((r) => r.kind === 'defect');
  const benign = results.filter((r) => r.kind === 'benign');
  const killed = defects.filter((r) => r.killed).length;
  const falseAlarms = benign.filter((r) => r.killed).length;
  return {
    killed,
    total: defects.length,
    // Zero defect mutants is an invalid run, not a perfect score.
    score: defects.length ? killed / defects.length : null,
    survivors: defects.filter((r) => !r.killed).map((r) => r.name),
    falseAlarms,
    benignTotal: benign.length,
    falseAlarmRate: benign.length ? falseAlarms / benign.length : null,
  };
}

export function gate(s: ReturnType<typeof summarize>, t = THRESHOLDS): string[] {
  const v: string[] = [];
  if (s.score === null) v.push('invalid run: zero defect mutants');
  else if (s.score < t.minMutationScore) v.push(`mutation score ${pct(s.score)} < ${pct(t.minMutationScore)}`);
  if (s.falseAlarmRate === null) v.push('invalid run: zero benign mutants (false alarm rate unmeasured)');
  else if (s.falseAlarmRate > t.maxFalseAlarmRate) v.push(`false alarm rate ${pct(s.falseAlarmRate)} > ${pct(t.maxFalseAlarmRate)}`);
  return v;
}

export const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);

export function accuracy<T>(a: T[], b: T[]) {
  if (a.length !== b.length || !a.length) throw new Error('accuracy: need equal, non-empty label arrays');
  return a.filter((x, i) => x === b[i]).length / a.length;
}

// Cohen's kappa for two raters over the same items.
export function cohenKappa<T>(a: T[], b: T[]) {
  const po = accuracy(a, b);
  const n = a.length;
  const pe = [...new Set([...a, ...b])].reduce((s, c) => s + (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe); // pe === 1: both raters constant and identical
}
