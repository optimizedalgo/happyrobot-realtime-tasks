#!/usr/bin/env node
const API = process.env.API_URL || 'http://localhost:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(path, { method = 'GET', body, expected } = {}) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = r.status === 204 ? null : await r.json().catch(() => null);
  if (expected !== undefined) {
    if (r.status !== expected) throw new Error(`${method} ${path}: expected ${expected}, got ${r.status}: ${JSON.stringify(data)}`);
    return { status: r.status, data };
  }
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status}: ${JSON.stringify(data)}`);
  return data;
}
async function nextSSE(response, type, timeoutMs = 6000) {
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = '';
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout waiting for SSE ${type}`)), timeoutMs));
  const read = (async () => {
    while (true) {
      const { value, done } = await reader.read(); if (done) throw new Error('SSE ended');
      buf += decoder.decode(value, { stream: true });
      for (;;) {
        const i = buf.indexOf('\n\n'); if (i < 0) break;
        const frame = buf.slice(0, i); buf = buf.slice(i + 2); let event = '', data = '';
        for (const line of frame.split('\n')) { if (line.startsWith('event: ')) event = line.slice(7); if (line.startsWith('data: ')) data += line.slice(6); }
        if (event === type) { await reader.cancel(); return JSON.parse(data); }
      }
    }
  })();
  return Promise.race([read, timeout]);
}

console.log('1) health + project catalog realtime');
await req('/health');
const projectSnapshot = await req('/api/projects');
const projectStreamPromise = fetch(`${API}/api/project-events?lastEventId=${projectSnapshot.syncCursor}`, { headers: { Accept: 'text/event-stream' } });
await sleep(100);
const p = await req('/api/projects', { method: 'POST', body: { name: `Smoke ${Date.now()}`, description: 'integration test', metadata: { largeFieldReference: 'detail-only' } } });
const projectStream = await projectStreamPromise;
const projectEvent = await nextSSE(projectStream, 'project.created');
if (projectEvent.id !== p.id) throw new Error('project.created mismatch');

console.log('2) versioned project update + detail metadata');
const updatedProject = await req(`/api/projects/${p.id}`, { method: 'PATCH', body: { description: 'updated', metadata: { region: 'us', nested: { ok: true } }, version: p.version } });
if (updatedProject.version !== p.version + 1 || updatedProject.metadata.region !== 'us') throw new Error('project update failed');
await req(`/api/projects/${p.id}`, { method: 'PATCH', body: { description: 'stale', version: p.version }, expected: 409 });

console.log('3) verify SSE task delta');
const snap = await req(`/api/projects/${p.id}/tasks?limit=100`);
const streamPromise = fetch(`${API}/api/events?projectId=${p.id}&lastEventId=${snap.syncCursor}`, { headers: { Accept: 'text/event-stream' } });
await sleep(100);
const a = await req(`/api/projects/${p.id}/tasks`, { method: 'POST', body: { title: 'Dependency A', configuration: { priority: 'high', description: 'smoke', tags: ['test'], customFields: { estimate: '2h' } } } });
const stream = await streamPromise;
const event = await nextSSE(stream, 'task.created');
if (event.id !== a.id) throw new Error('SSE task.created entity mismatch');

console.log('4) searchable dependency lookup');
const search = await req(`/api/projects/${p.id}/tasks?search=${encodeURIComponent('Dependency A')}&limit=20`);
if (!search.items.some((x) => x.id === a.id)) throw new Error('task search failed');

console.log('5) dependency rule + legal completion');
const b = await req(`/api/projects/${p.id}/tasks`, { method: 'POST', body: { title: 'Dependent B', dependencies: [a.id] } });
await req(`/api/tasks/${b.id}`, { method: 'PATCH', body: { status: 'done', version: b.version }, expected: 409 });
const aDone = await req(`/api/tasks/${a.id}`, { method: 'PATCH', body: { status: 'done', version: a.version } });
const bDone = await req(`/api/tasks/${b.id}`, { method: 'PATCH', body: { status: 'done', version: b.version } });
if (aDone.status !== 'done' || bDone.status !== 'done') throw new Error('completion failed');

console.log('6) stale task write + referenced delete protection');
await req(`/api/tasks/${a.id}`, { method: 'PATCH', body: { title: 'stale write', version: a.version }, expected: 409 });
await req(`/api/tasks/${a.id}`, { method: 'DELETE', expected: 409 });

console.log('7) comments + durable event-delta fallback');
const beforeComment = await req(`/api/projects/${p.id}/tasks?limit=1`);
const c = await req(`/api/tasks/${b.id}/comments`, { method: 'POST', body: { author: 'Smoke Test', content: 'hello realtime' } });
const comments = await req(`/api/tasks/${b.id}/comments`);
if (!comments.some((x) => x.id === c.id)) throw new Error('comment missing');
const deltas = await req(`/api/event-deltas?projectId=${p.id}&after=${beforeComment.syncCursor}`);
if (!deltas.items.some((x) => x.eventType === 'comment.created' && x.entityId === c.id)) throw new Error('durable delta fallback missing comment');

console.log('SMOKE PASS');
