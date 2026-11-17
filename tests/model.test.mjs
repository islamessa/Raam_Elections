import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aggregate, baseParams, simulate, project, scenarios, priorityGroup, potentialGain, votesPerSeat, rates,
} from '../docs/js/model.js';

const data = JSON.parse(readFileSync(new URL('../docs/data/negev.json', import.meta.url)));
const last = data.elections.at(-1);
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test('localities add up to the Negev aggregate of every election', () => {
  for (const e of data.elections) {
    const agg = aggregate(data.localities, String(e.id));
    for (const k of ['eligible', 'voters', 'invalid', 'valid', 'raam']) assert.equal(agg[k], e.negev[k]);
  }
});

test('simulation with baseline parameters reproduces the real election', () => {
  for (const e of data.elections) {
    const r = simulate(e, baseParams(e));
    close(r.raamNegev, e.negev.raam);
    close(r.raamTotal, e.national.raam);
    close(r.nationalValid, e.national.valid);
    close(r.votesPerSeat, votesPerSeat(e));
  }
});

test('approximate seats are within one seat of the official result', () => {
  for (const e of data.elections) {
    const r = simulate(e, baseParams(e));
    assert.ok(Math.abs(r.seatsTotal - e.national.raamSeats) < 1, `K${e.id}: ${r.seatsTotal} vs ${e.national.raamSeats}`);
  }
});

test('projection with zero years equals the base election', () => {
  const p = { ...baseParams(last), growth: 0.05, natGrowth: 0.02, outsideGrowth: 0.02 };
  const r = project(last, p, 0);
  close(r.eligible, last.negev.eligible);
  close(r.raamTotal, last.national.raam);
});

test('zero growth keeps eligible voters constant; growth compounds', () => {
  const p = { ...baseParams(last), growth: 0, natGrowth: 0, outsideGrowth: 0 };
  close(project(last, p, 8).eligible, last.negev.eligible);
  close(project(last, { ...p, growth: 0.1 }, 2).eligible, last.negev.eligible * 1.21);
});

test('higher Negev turnout gives more Ra\'am votes', () => {
  const b = baseParams(last);
  const lo = simulate(last, { ...b, turnout: 0.5 });
  const hi = simulate(last, { ...b, turnout: 0.6 });
  assert.ok(hi.raamNegev > lo.raamNegev);
  close(hi.raamNegev - lo.raamNegev, last.negev.eligible * 0.1 * (1 - b.invalidRate) * b.raamShare);
});

test('scenarios are ordered conservative <= realistic <= optimistic', () => {
  const s = scenarios(data);
  const v = (k) => project(last, s[k], 4).raamNegev;
  assert.ok(v('conservative') <= v('realistic') && v('realistic') <= v('optimistic'));
});

test('priority groups and potential gain', () => {
  const avg = { turnout: 0.5, raamShare: 0.7 };
  const mk = (t, s) => ({ eligible: 1000, voters: 1000 * t, invalid: 0, valid: 1000 * t, raam: 1000 * t * s });
  assert.equal(priorityGroup(mk(0.3, 0.9), avg), 'mobilize');
  assert.equal(priorityGroup(mk(0.8, 0.3), avg), 'persuade');
  assert.equal(priorityGroup(mk(0.8, 0.9), avg), 'stronghold');
  assert.equal(priorityGroup(mk(0.3, 0.3), avg), 'challenge');
  close(potentialGain(mk(0.3, 0.9), 0.5), 1000 * 0.2 * 0.9);
  assert.equal(potentialGain(mk(0.8, 0.9), 0.5), 0);
  close(rates(mk(0.3, 0.9)).turnout, 0.3);
});
