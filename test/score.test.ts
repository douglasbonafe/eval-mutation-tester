import { describe, expect, it } from 'vitest';
import { cohenKappa, gate, summarize, type MutantResult } from '../src/score';
import { BASELINE } from '../src/sut';
import { runSuite } from '../src/suite';
import { MUTATORS } from '../src/mutators';

const m = (name: string, kind: 'defect' | 'benign', killed: boolean): MutantResult => ({ name, kind, killed, killedBy: [] });

describe('mutation score', () => {
  it('computes killed/total, survivors and false alarm rate', () => {
    const s = summarize([m('a', 'defect', true), m('b', 'defect', false), m('c', 'defect', true), m('d', 'defect', true), m('x', 'benign', true), m('y', 'benign', false)]);
    expect(s).toMatchObject({ killed: 3, total: 4, score: 0.75, survivors: ['b'], falseAlarms: 1, falseAlarmRate: 0.5 });
    expect(gate(s, { minMutationScore: 0.8, maxFalseAlarmRate: 0, minJudgeKappa: 0 })).toHaveLength(2);
    expect(gate(s, { minMutationScore: 0.75, maxFalseAlarmRate: 0.5, minJudgeKappa: 0 })).toEqual([]);
  });
  it('zero mutants is invalid, not 100%', () => {
    const s = summarize([]);
    expect(s.score).toBeNull();
    expect(s.falseAlarmRate).toBeNull();
    expect(gate(s).join()).toMatch(/invalid run: zero defect mutants/);
  });
});

describe('cohen kappa', () => {
  it('matches hand-computed values', () => {
    expect(cohenKappa([1, 1, 0, 0], [1, 0, 0, 0])).toBeCloseTo(0.5); // po .75, pe .5
    expect(cohenKappa(['p', 'f', 'p'], ['p', 'f', 'p'])).toBe(1);
    expect(cohenKappa([1, 0, 1, 0], [0, 1, 0, 1])).toBeCloseTo(-1);
    expect(cohenKappa([1, 1], [1, 1])).toBe(1); // degenerate pe = 1
  });
  it('rejects mismatched lengths', () => expect(() => cohenKappa([1], [1, 0])).toThrow());
});

describe('harness sanity', () => {
  it('baseline passes the whole suite', () => expect(runSuite(BASELINE).filter((c) => c.failed.length)).toEqual([]));
  it('every mutator applies (no silent no-op mutants)', () => MUTATORS.forEach((mu) => expect(() => mu.apply(BASELINE)).not.toThrow()));
});
