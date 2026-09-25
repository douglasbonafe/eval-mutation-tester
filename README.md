# eval-mutation-tester

**Does your eval suite actually catch defects?** This project uses mutation testing on an LLM eval suite. We inject controlled defects into a support assistant (the prompt, the docs, the tools, the model output). Then we check whether the eval suite fails. If a defect gets through without failing anything, that is a gap in the suite, and we name it. We also inject *benign* changes to measure false alarms. A suite that flags everything is as useless as a suite that flags nothing.

Project 6 of an LLM-QA portfolio. Everything runs offline and is deterministic.

## What is simulated (read this first)

| Part | Real or simulated |
|---|---|
| System under test "HelpDesk" (Acme Cloud support assistant) | **Simulated.** `simulatedModel` in `src/sut.ts` is a deterministic rule engine, not an LLM. Its behavior really does depend on which rules appear in the prompt, which docs are in the corpus, and what the tools return. That dependency is the reason mutations have observable effects. |
| Tools (`lookup_order`, `issue_refund`, `escalate_to_human`, `change_plan`, `lookup_customer`) | Mocked, fixture-backed. |
| Doc corpus | 4 tiny current docs plus 2 superseded versions. |
| LLM-as-judge | **Heuristic stand-in** (`judge()` in `src/suite.ts`): lexical overlap with the question and the reference, a citation bonus, sentence completeness, and a small length term. |
| Human labels (`data/human-labels.json`) | **Illustrative labels written by the author for this demo.** No real annotators were involved. |

## Layout

```
src/sut.ts             system under test: prompt rules, docs, mocked tools, simulated model, run()
src/suite.ts           eval suite: 23 cases, deterministic assertions, heuristic judge
src/mutators.ts        14 defect mutators + 3 benign mutators (a plain array of {name, apply})
src/score.ts           mutation score, false-alarm rate, CI gate + thresholds, accuracy, Cohen's kappa
src/mutate.ts          `npm run mutate` -> report.md
src/judge-validate.ts  `npm run judge:validate` -> judge vs labels agreement + bias probes
data/human-labels.json 20 illustrative labels
test/score.test.ts     Vitest: score math (zero mutants -> invalid), kappa, baseline sanity
.github/workflows/mutation.yml, Dockerfile
```

## Mutators

| # | Family | Mutants | What the defect looks like |
|---|---|---|---|
| 1 | Remove rule from prompt | `remove-rule:{verify,escalate,privacy,cite,noPromises,concise}` | One numbered rule line is deleted from the system prompt |
| 2 | Superseded doc | `superseded-doc:refund-policy-v3->v2`, `sla-v2->sla-v1` | A stale policy version is served in place of the current one (14 vs 30 days, 12 h vs 4 h) |
| 3 | Non-existent citation | `fake-citation` | `[kb-legacy-2019]` gets appended to every answer |
| 4 | Altered tool argument | `tool-arg:refund-amount-x10`, `tool-arg:wrong-account-id` | Arguments are corrupted between the model and the tool |
| 5 | Truncation / timeout | `truncated-response`, `timeout:every-3rd-request` | The answer is cut at 60%, or the model throws a timeout on every 3rd request |
| 6 | Success without action | `success-without-action` | Action tools are silently skipped and return a fake `ok`. The agent still says "done" |
| B | Benign | `benign:reformat-prompt`, `benign:synonym-reword`, `benign:reorder-docs` | Whitespace changes, synonyms ("Never" -> "Do not", "Cite" -> "Reference"...), reversed doc order |

A mutant is **killed** when at least one assertion fails on at least one case. **Mutation score** = killed / defect mutants. **False alarm rate** = benign mutants killed / benign mutants. If there are zero defect mutants, the run is **invalid**. It is not scored as 100%. If the baseline (unmutated) system fails the suite, `mutate` aborts with exit code 2, because kills measured against a broken baseline mean nothing. As an extra guard, a remove-rule mutator throws an error if its rule is missing from the prompt, so a no-op mutant cannot quietly "survive".

## Run

```bash
npm install
npm test                 # vitest
npm run typecheck
npm run mutate           # writes report.md; exit 1 if the CI gate fails, 2 if the baseline is invalid
npm run judge:validate   # exit 1 if kappa < THRESHOLDS.minJudgeKappa
```

Docker:

```bash
docker build -t eval-mutation-tester .
docker run --rm eval-mutation-tester
```

CI (`.github/workflows/mutation.yml`) runs typecheck, tests, judge validation and mutate on every PR, and uploads `report.md`. The thresholds are set in `THRESHOLDS` in `src/score.ts`: `minMutationScore: 0.8`, `maxFalseAlarmRate: 0`, `minJudgeKappa: 0.3`.

## Measured results (pasted from a real local run)

`npm run mutate` (full output in `report.md`):

```
Baseline: 23/23 cases pass (valid baseline).

| Mutation score (killed / defect mutants) | 13/14 = 92.9% | >= 80.0% |
| False alarm rate (killed benign / benign) | 0/3 = 0.0%    | <= 0.0%  |
| Gate | PASS |

Survivors:
- GAP: remove-rule:concise -- no assertion failed on any case.

| assertion                | mutants killed | sole killer of                                       |
| citation:exists          | 1 | fake-citation                                                   |
| citation:expected-doc    | 5 | remove-rule:cite                                                |
| content:mentions         | 7 | -                                                               |
| content:not-mentions     | 2 | remove-rule:noPromises                                          |
| format:complete-sentence | 2 | -                                                               |
| format:schema            | 1 | -                                                               |
| judge:quality            | 2 | -                                                               |
| tool:args                | 7 | tool-arg:refund-amount-x10, tool-arg:wrong-account-id           |
| tool:not-called          | 3 | -                                                               |
| tool:order               | 2 | -                                                               |
```

`npm run judge:validate`:

```
Items: 20
Accuracy: 75.0%
Cohen's kappa: 0.490 (min 0.3)
Disagreements:
- h02: human=fail judge=pass (score 0.786)   <- superseded "14 days" answer with a citation
- h08: human=fail judge=pass (score 0.635)   <- "I've reset your password" (agents can't)
- h13: human=pass judge=fail (score 0.473)   <- correct privacy refusal, no citation
- h15: human=pass judge=fail (score 0.526)   <- correct "can't promise a date"
- h20: human=fail judge=pass (score 0.656)   <- hallucinated "24/7 phone support" with a citation
Position bias: 0/10 pairs change winner when A/B order is swapped.
Verbosity bias: padding raised the score of 20/20 answers; 0 flipped fail -> pass.
```

### What the numbers say

- **Real gap:** removing "Keep answers under 80 words" goes undetected. The model then appends about 50 words of filler to every answer, and no assertion checks length. The judge does not catch it either, because it has a small length *bonus*. The verbosity probe confirms this: padding raised the score of 20 out of 20 answers. The fix would be a `format:max-words` assertion. We deliberately left the gap in place so the report shows an honest survivor.
- **`judge:quality` is never the sole killer.** Every defect it catches is also caught by a deterministic assertion. In this suite, the judge adds cost without adding detection power.
- **The judge rewards form over facts.** It passes stale or hallucinated answers that carry a citation (h02, h20) and fails correct refusals that have none (h13, h15). This is the reason content facts are checked deterministically.
- **Position bias: 0/10.** This comes from the tie-break (ties go to A), and none of the 10 pairs tied. The probe is weak on this data, which does not prove the judge is unbiased.
- **Fragile coverage:** a single assertion type is the only thing standing between us and 5 of the killed mutants (see "sole killer of"). For example, if `tool:args` were removed, both tool-argument mutants would survive.

Background on judge biases (position, verbosity, self-enhancement) and agreement with humans: Zheng et al., *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena*, arXiv:2306.05685.

## Limitations

- The SUT is a rule engine. Real LLMs are stochastic, so a real setup needs repeated samples per case and a statistical kill criterion (for example, the failure rate must exceed the baseline flake rate), not "any failure".
- The mutants are hand-written and few (14 + 3). The score is only as good as the mutant set. Mutants that are equivalent or trivial inflate it (`fake-citation` and `truncated-response` fail 23/23 cases).
- The benign set is small. A 0% false-alarm rate on 3 mutants is weak evidence.
- The human labels are illustrative, n = 20 and binary. The kappa has wide uncertainty and no confidence interval is computed.
- The heuristic judge is not an LLM judge. The bias probes demonstrate the method, not the biases of any real model.
- `promptfoo` is not used. The suite is plain TypeScript to keep the dependency count at 1 (zod).

## 3-minute video script outline

1. **0:00-0:20 Hook.** "Your evals are green. Would they be red if the bot broke?" Show the 23/23 green baseline.
2. **0:20-0:50 The system.** HelpDesk: prompt rules, docs (current and superseded), mocked tools. Point out that it is a labeled simulation.
3. **0:50-1:30 The mutators.** Walk the table. Live demo: `remove-rule:escalate`. The $250 refund goes through without escalation, and `tool:not-called` catches it.
4. **1:30-2:00 `npm run mutate`.** Show report.md: 92.9% score, 0% false alarms, and the highlighted survivor `remove-rule:concise`.
5. **2:00-2:30 Judge validation.** Kappa 0.49, the disagreement list, and the verbosity probe showing 20/20 scores inflated by padding. Tie this back to the survivor. Cite MT-Bench (arXiv 2306.05685).
6. **2:30-3:00 CI gate and limits.** The workflow fails when the score drops below 80% or false alarms go above 0. Close with the limitations: simulation, small mutant set, illustrative labels.
