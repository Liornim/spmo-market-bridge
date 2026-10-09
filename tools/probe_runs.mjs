// status of the latest nightly runs and their steps (public repo: no token needed)
const R = 'https://api.github.com/repos/Liornim/spmo-market-bridge/actions';
const j = await (await fetch(`${R}/workflows/nightly.yml/runs?per_page=4`, { headers: { 'User-Agent': 'probe' } })).json();
for (const r of j.workflow_runs || []) {
  console.log(`run ${r.id} ${r.event} ${r.status}/${r.conclusion} started ${r.run_started_at} updated ${r.updated_at} commit "${(r.head_commit?.message || '').split('\n')[0].slice(0, 70)}"`);
  if (r.status !== 'completed' || r === j.workflow_runs[0]) {
    const jobs = await (await fetch(`${R}/runs/${r.id}/jobs`, { headers: { 'User-Agent': 'probe' } })).json();
    for (const jb of jobs.jobs || []) for (const s of jb.steps || []) console.log(`   ${s.status}/${s.conclusion || ''} ${s.name} ${s.started_at || ''} → ${s.completed_at || ''}`);
  }
}
