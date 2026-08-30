#!/usr/bin/env node
import os from 'node:os';
import fs from 'node:fs/promises';

const API = process.env.API_URL || 'http://localhost:8080';
const total = Number(process.env.TASKS || process.argv[2] || 10000);
const concurrency = Number(process.env.CONCURRENCY || 25);
const writeResults = process.env.WRITE_RESULTS === '1';

async function json(path, init) {
  const r = await fetch(API + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

const project = await json('/api/projects', { method: 'POST', body: JSON.stringify({ name: `Load test ${new Date().toISOString()}`, description: `${total} generated tasks` }) });
console.log(`Project: ${project.id}`);
let next = 0, ok = 0, failed = 0;
const started = performance.now();
async function worker() {
  while (true) {
    const i = next++;
    if (i >= total) return;
    try {
      await json(`/api/projects/${project.id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: `Generated task ${i + 1}`,
          configuration: { priority: i % 10 === 0 ? 'high' : 'medium', description: 'load-generated', tags: ['load'], customFields: { index: i } },
        }),
      });
      ok++;
    } catch (e) {
      failed++;
      if (failed <= 20) console.error(`task ${i + 1}:`, e.message);
    }
    if ((ok + failed) % 1000 === 0) console.log(`${ok + failed}/${total}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsed = (performance.now() - started) / 1000;
const throughput = ok / elapsed;
console.log(`Created ${ok}/${total} tasks in ${elapsed.toFixed(2)}s (${throughput.toFixed(1)} writes/s), failures=${failed}`);

const lat = [];
let cursor = '';
let read = 0;
while (true) {
  const t = performance.now();
  const page = await json(`/api/projects/${project.id}/tasks?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  lat.push(performance.now() - t);
  read += page.items.length;
  cursor = page.nextCursor;
  if (!cursor) break;
}
lat.sort((a, b) => a - b);
const pct = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] || 0;
const p50 = pct(.50), p95 = pct(.95), p99 = pct(.99), max = lat.at(-1) || 0;
console.log(`Read ${read} tasks via cursor pagination across ${lat.length} pages`);
console.log(`Page latency ms: p50=${p50.toFixed(1)} p95=${p95.toFixed(1)} p99=${p99.toFixed(1)} max=${max.toFixed(1)}`);

if (writeResults) {
  const cpus = os.cpus();
  const report = `# Measured Performance Results\n\nGenerated: ${new Date().toISOString()}\n\n## Environment\n\n- API target: \`${API}\`\n- OS: ${os.type()} ${os.release()} (${os.arch()})\n- CPU: ${cpus[0]?.model || 'unknown'} (${cpus.length} logical CPUs)\n- Memory: ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB\n- Node: ${process.version}\n- Requested concurrency: ${concurrency}\n\n## Results\n\n| Metric | Result |\n|---|---:|\n| Requested tasks | ${total} |\n| Successful writes | ${ok} |\n| Failed writes | ${failed} |\n| Write duration | ${elapsed.toFixed(2)} s |\n| Write throughput | ${throughput.toFixed(1)} tasks/s |\n| Tasks read | ${read} |\n| Cursor pages | ${lat.length} |\n| Page p50 | ${p50.toFixed(1)} ms |\n| Page p95 | ${p95.toFixed(1)} ms |\n| Page p99 | ${p99.toFixed(1)} ms |\n| Page max | ${max.toFixed(1)} ms |\n\n> These are measured results from the machine that executed \`scripts/load.mjs\`; they are not synthetic numbers committed by the implementation author.\n`;
  await fs.writeFile(new URL('../docs/PERFORMANCE_RESULTS.md', import.meta.url), report);
  console.log('Wrote docs/PERFORMANCE_RESULTS.md');
}
