// STATE MACHINE QA — mechanical invariants over a finished replay.
// Observes only. It never calls into the engine's decision path.
module.exports = function stateMachineQA(ctx) {
  const { states, rows, CFG } = ctx;
  // The engine judges a structure broken on a CLOSE below its invalidation, or
  // a tick 1.5 ATR past the stop. The invariants must use the same definition,
  // or they test a rule the engine does not have.
  const broken = (i, plan) => {
    if (!plan) return false;
    const r = rows[i], atr = (states[i] && states[i].atr) || 0.01;
    return r.close < plan.invalidation || r.low < plan.stop - 1.5 * atr;
  };
  const out = [];
  const add = (id, name, ok, detail) => out.push({ id, name, ok, detail: detail || '' });

  // FAILED must not become READY under the same setupId
  {
    let bad = [], failedIds = new Set();
    states.forEach(s => {
      if (s.state === 'FAILED' && s.setupId) failedIds.add(s.setupId);
      if (s.state === 'READY' && s.setupId && failedIds.has(s.setupId)) bad.push(s.time + ' ' + s.setupId);
    });
    add('SM-001', 'a FAILED setupId never returns to READY', bad.length === 0, bad.slice(0, 3).join(', '));
  }
  // age never exceeds the limit, and re-detection never resets it
  {
    const first = {}, over = [], resets = [];
    states.forEach(s => {
      if (!s.setupId) return;
      if (first[s.setupId] == null) first[s.setupId] = s.setupDetectedBar;
      else if (s.setupDetectedBar !== first[s.setupId]) resets.push(s.time + ' ' + s.setupId);
      if (s.setupAgeBars > CFG.maxSetupAgeBars && ['SETUP','ARMED','READY','ACTIVE'].includes(s.state))
        over.push(s.time + ' ' + s.setupId + ' age ' + s.setupAgeBars);
    });
    add('SM-002', 'no live setup exceeds maxSetupAgeBars', over.length === 0, over.slice(0, 3).join(', '));
    add('SM-003', 're-detecting a setup never resets its createdAt', resets.length === 0, resets.slice(0, 3).join(', '));
  }
  // the trigger is frozen once armed
  {
    const trig = {}, moved = [];
    states.forEach(s => {
      if (!s.setupId || !s.plan) return;
      if (trig[s.setupId] == null) trig[s.setupId] = s.plan.entry;
      else if (s.plan.entry !== trig[s.setupId])
        moved.push(s.time + ' ' + s.setupId + ' ' + trig[s.setupId] + '->' + s.plan.entry);
    });
    add('SM-004', 'the trigger never moves after a setup is armed', moved.length === 0, moved.slice(0, 3).join(', '));
  }
  // a moving window must not mint an id per candle
  {
    const bars = {}, ids = new Set();
    states.forEach(s => { if (s.setupId) { ids.add(s.setupId); bars[s.setupId] = (bars[s.setupId] || 0) + 1; } });
    const perId = ids.size ? Object.values(bars).reduce((a, b) => a + b, 0) / ids.size : 0;
    add('SM-005', 'setups persist rather than being minted per candle',
      ids.size === 0 || perId >= 3, ids.size + ' ids, ' + perId.toFixed(1) + ' bars each');
  }
  // a satisfied confirmation must not regress without invalidation
  {
    const bad = [];
    for (let i = 1; i < states.length; i++) {
      const p = states[i - 1], n = states[i];
      if (p.state !== 'ARMED' || !p.plan) continue;
      const met = rows[i].high >= p.plan.entry, inval = broken(i, p.plan);
      if (met && !inval && (n.state === 'AVOID' || n.state === 'WATCH'))
        bad.push(n.time + ': trigger ' + p.plan.entry + ' met, went ' + n.state);
    }
    add('SM-006', 'a satisfied confirmation never regresses without invalidation',
      bad.length === 0, bad.slice(0, 3).join(' | '));
  }
  // structural invalidation overrides the old score
  {
    const bad = [];
    for (let i = 1; i < states.length; i++) {
      const p = states[i - 1];
      if (!p.plan || !['ARMED','READY','ACTIVE'].includes(p.state)) continue;
      if (broken(i, p.plan) && states[i].setupId === p.setupId
          && states[i].state !== 'FAILED') bad.push(states[i].time);
    }
    add('SM-007', 'a broken invalidation fails the setup whatever the score', bad.length === 0, bad.slice(0, 3).join(', '));
  }
  // no READY below the configured score, and never without a plan
  {
    const weak = states.filter(s => s.state === 'READY' && s.score < CFG.readyScore);
    const planless = states.filter(s => s.state === 'READY' && !s.plan);
    add('SM-008', 'no READY below the score threshold', weak.length === 0, weak.length + ' found');
    add('SM-009', 'no READY without a plan', planless.length === 0, planless.length + ' found');
  }
  // never jump straight from AVOID to READY
  {
    let jumps = 0;
    for (let i = 1; i < states.length; i++)
      if (states[i - 1].state === 'AVOID' && states[i].state === 'READY') jumps++;
    add('SM-010', 'never jumps from AVOID straight to READY', jumps === 0, jumps + ' jumps');
  }
  // every state explains itself
  {
    const mute = states.filter(s => !s.reason || !s.next);
    add('SM-011', 'every state carries a reason and a next step', mute.length === 0, mute.length + ' mute states');
  }
  // no duplicate setup ids for what is structurally one setup
  {
    const byAnchor = {};
    states.forEach(s => {
      if (!s.setup || s.setup.type !== 'STRUCTURAL_BASE') return;
      const k = s.setup.anchorLowTime + '|' + s.setup.anchorHighTime;
      (byAnchor[k] = byAnchor[k] || new Set()).add(s.setupId);
    });
    const dupes = Object.entries(byAnchor).filter(([, v]) => v.size > 1);
    add('SM-012', 'one structure never carries more than one setupId',
      dupes.length === 0, dupes.slice(0, 2).map(([k, v]) => k + ' -> ' + v.size).join(', '));
  }
  // SM-013: a breach of the live invalidation is recorded as FAILED even when a
  // different setup type is detected on that same bar. Found by adversarial QA:
  // the old setup evaporated into WATCH and neither cooldown nor retirement ran.
  {
    const missed = [];
    for (let i = 1; i < states.length; i++) {
      const p = states[i - 1];
      if (!p.plan || !p.setupId || !['SETUP','ARMED','READY','ACTIVE'].includes(p.state)) continue;
      if (broken(i, p.plan) && states[i].state !== 'FAILED') missed.push(states[i].time + ' ' + p.setupId);
    }
    add('SM-013', 'a live invalidation breach is always recorded as FAILED', missed.length === 0, missed.slice(0, 3).join(', '));
  }
  // SM-014: the plan ledger survives a one-bar interruption by another setup.
  // Found on AMD 12:53: the trigger was rebuilt under the same id.
  {
    const first = {}, rebuilt = [];
    states.forEach(s => {
      if (!s.setupId || !s.plan) return;
      if (first[s.setupId] == null) first[s.setupId] = s.plan.entry;
      else if (s.plan.entry !== first[s.setupId]) rebuilt.push(s.time + ' ' + s.setupId);
    });
    add('SM-014', 'a trigger survives interruption by a different setup', rebuilt.length === 0, rebuilt.slice(0, 3).join(', '));
  }
  return out;
};
