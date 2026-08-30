'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { Task } from '@/lib/types';

export default function DependencyPicker({ task, loadedTasks, onChange }: {
  task: Task;
  loadedTasks: Task[];
  onChange: (dependencies: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [known, setKnown] = useState<Record<string, Task>>({});

  useEffect(() => {
    setKnown((prev) => {
      const next = { ...prev };
      for (const item of loadedTasks) next[item.id] = item;
      return next;
    });
  }, [loadedTasks]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const page = await api.searchTasks(task.projectId, query.trim(), 20);
        const items = page.items.filter((item) => item.id !== task.id);
        setResults(items);
        setKnown((prev) => {
          const next = { ...prev };
          for (const item of items) next[item.id] = item;
          return next;
        });
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, task.id, task.projectId]);

  const selected = useMemo(() => task.dependencies.map((id) => known[id]).filter(Boolean), [task.dependencies, known]);

  const toggle = (id: string, checked: boolean) => {
    const dependencies = checked
      ? Array.from(new Set([...task.dependencies, id]))
      : task.dependencies.filter((value) => value !== id);
    void onChange(dependencies);
  };

  return <div className="deps">
    <div className="label-title">Dependencies <span className="muted">· searchable across 10k+ tasks</span></div>
    {task.dependencies.length > 0 && <div className="dependency-chips">
      {task.dependencies.map((id) => <button key={id} type="button" className="chip selected-chip" onClick={() => toggle(id, false)} title="Remove dependency">
        {known[id]?.title || `Task ${id.slice(0, 8)}`} <span>×</span>
      </button>)}
    </div>}
    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search project tasks…" aria-label="Search dependencies" />
    <div className="dep-list">
      {loading && <div className="small-empty">Searching…</div>}
      {!loading && results.length === 0 && <div className="small-empty">No matching tasks.</div>}
      {!loading && results.map((item) => <label className="check" key={item.id}>
        <input type="checkbox" checked={task.dependencies.includes(item.id)} onChange={(e) => toggle(item.id, e.target.checked)} />
        <span><b>{item.title}</b><small>{item.status.replace('_', ' ')} · {item.configuration.priority}</small></span>
      </label>)}
    </div>
    {selected.length > 0 && <p className="helper">A task can move to done only after all dependencies are done. Cycles are rejected server-side.</p>}
  </div>;
}
