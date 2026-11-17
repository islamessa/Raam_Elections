// All calculations of the platform. Pure functions, no DOM.
// Rates are fractions (0.81 = 81%).

export const SEATS = 120;

export const rate = (a, b) => (b > 0 ? a / b : 0);

/** Basic rates of one aggregate {eligible, voters, invalid, valid, raam}. */
export function rates(agg) {
  return {
    turnout: rate(agg.voters, agg.eligible),
    invalidRate: rate(agg.invalid, agg.voters),
    raamShare: rate(agg.raam, agg.valid),
  };
}

/** Sum the results of several localities for one election id. */
export function aggregate(localities, electionId, filter = () => true) {
  const out = { eligible: 0, voters: 0, invalid: 0, valid: 0, raam: 0, otherArab: 0 };
  for (const l of localities) {
    if (!filter(l)) continue;
    const r = l.results[electionId];
    if (!r) continue;
    for (const k in out) out[k] += r[k];
  }
  return out;
}

/** Votes needed for one seat (approximation: valid votes of lists above the threshold / 120). */
export function votesPerSeat(election) {
  return election.national.aboveThresholdValid / SEATS;
}

/**
 * Core engine shared by the simulator and the projections.
 * ctx:  { negevEligible, outsideValid, raamOutside, aboveShare, threshold }
 * p:    { turnout, invalidRate, raamShare }
 */
function compute(ctx, p) {
  const voters = ctx.negevEligible * p.turnout;
  const valid = voters * (1 - p.invalidRate);
  const raamNegev = valid * p.raamShare;
  const nationalValid = ctx.outsideValid + valid;
  const vps = (nationalValid * ctx.aboveShare) / SEATS;
  const raamTotal = ctx.raamOutside + raamNegev;
  const thresholdVotes = ctx.threshold * nationalValid;
  return {
    eligible: ctx.negevEligible,
    voters,
    valid,
    nonVoters: ctx.negevEligible - voters,
    raamNegev,
    raamOutside: ctx.raamOutside,
    raamTotal,
    nationalValid,
    votesPerSeat: vps,
    seatsTotal: raamTotal / vps,
    seatsNegev: raamNegev / vps,
    negevShareOfRaam: rate(raamNegev, raamTotal),
    thresholdVotes,
    thresholdMargin: raamTotal - thresholdVotes,
  };
}

/** Baseline parameters of an election (what actually happened). */
export function baseParams(election) {
  const n = election.negev, nat = election.national;
  return {
    ...rates(n),
    natTurnout: rate(nat.voters, nat.eligible),
  };
}

/**
 * "What if" for a past election.
 * p: { turnout, invalidRate, raamShare, natTurnout }
 * Assumption: Ra'am votes outside the Negev stay as they were; valid votes
 * outside the Negev scale with the national turnout.
 */
export function simulate(election, p) {
  const n = election.negev, nat = election.national;
  const natT0 = rate(nat.voters, nat.eligible);
  const ctx = {
    negevEligible: n.eligible,
    outsideValid: (nat.valid - n.valid) * rate(p.natTurnout, natT0),
    raamOutside: nat.raam - n.raam,
    aboveShare: rate(nat.aboveThresholdValid, nat.valid),
    threshold: 0.0325,
  };
  return compute(ctx, p);
}

/**
 * Projection from a base election.
 * p: { growth, turnout, invalidRate, raamShare, natGrowth, natTurnout, outsideGrowth }
 */
export function project(base, p, years) {
  const n = base.negev, nat = base.national;
  const natT0 = rate(nat.voters, nat.eligible);
  const ctx = {
    negevEligible: n.eligible * (1 + p.growth) ** years,
    outsideValid: (nat.valid - n.valid) * (1 + p.natGrowth) ** years * rate(p.natTurnout, natT0),
    raamOutside: (nat.raam - n.raam) * (1 + p.outsideGrowth) ** years,
    aboveShare: rate(nat.aboveThresholdValid, nat.valid),
    threshold: 0.0325,
  };
  return compute(ctx, p);
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/**
 * Three ready scenarios, all derived from official data:
 * turnout & Ra'am share = min / mean / max of the elections Ra'am ran alone;
 * growth = CBS population growth (conservative) or CEC eligible-voter growth.
 */
export function scenarios(data) {
  const solo = data.elections.filter((e) => e.raamAlone);
  const last = data.elections[data.elections.length - 1];
  const t = solo.map((e) => rates(e.negev).turnout);
  const s = solo.map((e) => rates(e.negev).raamShare);
  const common = {
    invalidRate: rates(last.negev).invalidRate,
    natGrowth: data.growth.nationalEligibleCagr,
    outsideGrowth: data.growth.nationalEligibleCagr,
    natTurnout: rate(last.national.voters, last.national.eligible),
  };
  return {
    conservative: { ...common, growth: data.growth.cbsPopCagrRecognized, turnout: Math.min(...t), raamShare: Math.min(...s) },
    realistic: { ...common, growth: data.growth.negevEligibleCagr, turnout: mean(t), raamShare: mean(s) },
    optimistic: { ...common, growth: data.growth.negevEligibleCagr, turnout: Math.max(...t), raamShare: Math.max(...s) },
  };
}

/**
 * Priority group of a locality relative to the Negev average.
 * mobilize: high support, low turnout   -> bring voters out
 * persuade: low support, high turnout   -> convince
 * stronghold: high & high               -> maintain
 * challenge: low & low
 */
export function priorityGroup(r, avg) {
  const { turnout, raamShare } = rates(r);
  const hiS = raamShare >= avg.raamShare, hiT = turnout >= avg.turnout;
  if (hiS && !hiT) return 'mobilize';
  if (!hiS && hiT) return 'persuade';
  if (hiS && hiT) return 'stronghold';
  return 'challenge';
}

/** Extra Ra'am votes if the locality reached `targetTurnout`, with its own support rate. */
export function potentialGain(r, targetTurnout) {
  const { turnout, raamShare, invalidRate } = rates(r);
  const extraVoters = Math.max(0, targetTurnout - turnout) * r.eligible;
  return extraVoters * (1 - invalidRate) * raamShare;
}
