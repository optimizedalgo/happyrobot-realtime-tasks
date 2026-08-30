'use client';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import TaskList from '@/components/TaskList';
import TaskDetail from '@/components/TaskDetail';
import ProjectSettings from '@/components/ProjectSettings';
import { api } from '@/lib/api';
import { useProjectCatalogEvents, useProjectEvents } from '@/lib/realtime';
import type { Comment, Project, Task } from '@/lib/types';

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectCursor, setProjectCursor] = useState<number>();
  const [activeId, setActiveId] = useState<string>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cursor, setCursor] = useState('');
  const [syncCursor, setSyncCursor] = useState<number>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [liveComments, setLiveComments] = useState<Comment[]>([]);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [newTask, setNewTask] = useState('');
  const [notice, setNotice] = useState('');

  const active = useMemo(() => projects.find((p) => p.id === activeId), [projects, activeId]);
  const selected = useMemo(() => tasks.find((t) => t.id === selectedId), [tasks, selectedId]);

  useEffect(() => {
    api.projects().then((page) => {
      setProjects(page.items);
      setProjectCursor(page.syncCursor);
      if (page.items[0]) setActiveId(page.items[0].id);
    }).catch((e) => setNotice(`Could not load projects: ${(e as Error).message}`));
  }, []);

  // List responses intentionally omit potentially-large metadata. Fetch one project detail on selection.
  useEffect(() => {
    if (!activeId) return;
    api.project(activeId).then((full) => setProjects((items) => items.map((p) => p.id === full.id ? full : p))).catch(() => undefined);
  }, [activeId]);

  useEffect(() => {
    if (!activeId) { setTasks([]); return; }
    setSelectedId(undefined);
    setSettingsOpen(false);
    setSyncCursor(undefined);
    api.tasks(activeId).then((page) => {
      setTasks(page.items);
      setCursor(page.nextCursor);
      setSyncCursor(page.syncCursor);
    }).catch((e) => setNotice(`Could not load tasks: ${(e as Error).message}`));
  }, [activeId]);

  const onCatalogEvent = useCallback((type: string, payload: any) => {
    if (type === 'project.created') {
      const project = payload as Project;
      setProjects((items) => items.some((p) => p.id === project.id) ? items : [project, ...items]);
    }
    if (type === 'project.updated') {
      const project = payload.project as Project;
      setProjects((items) => items.map((p) => p.id === project.id ? project : p));
    }
  }, []);

  const onProjectEvent = useCallback((type: string, payload: any) => {
    if (type === 'task.created') {
      const task = payload as Task;
      setTasks((items) => items.some((x) => x.id === task.id) ? items : [task, ...items]);
    }
    if (type === 'task.updated') {
      const task = payload.task as Task;
      setTasks((items) => items.map((x) => x.id === task.id ? task : x));
    }
    if (type === 'task.deleted') {
      setTasks((items) => items.filter((x) => x.id !== payload.id));
      setSelectedId((id) => id === payload.id ? undefined : id);
    }
    if (type === 'comment.created') setLiveComments((items) => [...items, payload as Comment].slice(-100));
  }, []);

  const catalogRealtime = useProjectCatalogEvents(projectCursor, onCatalogEvent);
  const projectRealtime = useProjectEvents(activeId, syncCursor, onProjectEvent);
  const realtimeLabel = projectRealtime === 'live' && catalogRealtime === 'live'
    ? 'Realtime live · SSE'
    : projectRealtime === 'polling' || catalogRealtime === 'polling'
      ? 'Realtime live · delta polling'
      : 'Realtime connecting…';

  async function createProject(e: FormEvent) {
    e.preventDefault();
    if (!projectName.trim()) return;
    try {
      const project = await api.createProject({ name: projectName.trim(), description: projectDescription.trim(), metadata: {} });
      setProjects((items) => items.some((p) => p.id === project.id) ? items : [project, ...items]);
      setProjectName(''); setProjectDescription(''); setActiveId(project.id); setSettingsOpen(true); setNotice('');
    } catch (e) { setNotice((e as Error).message); }
  }

  async function updateActiveProject(patch: Partial<Pick<Project, 'name' | 'description' | 'metadata'>>) {
    if (!active) return;
    const before = active;
    const optimistic: Project = { ...active, ...patch, version: active.version + 1, updatedAt: new Date().toISOString() };
    setProjects((items) => items.map((p) => p.id === active.id ? optimistic : p));
    try {
      const saved = await api.updateProject(before, patch);
      setProjects((items) => items.map((p) => p.id === saved.id ? saved : p));
      setNotice('');
    } catch (e: any) {
      const current = e.current as Project | undefined;
      setProjects((items) => items.map((p) => p.id === before.id ? (current || before) : p));
      setNotice(e.message);
      throw e;
    }
  }

  async function openProjectSettings() {
    if (!activeId) return;
    try {
      const full = await api.project(activeId);
      setProjects((items) => items.map((p) => p.id === full.id ? full : p));
      setSelectedId(undefined);
      setSettingsOpen(true);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  async function createTask(e: FormEvent) {
    e.preventDefault();
    if (!activeId || !newTask.trim()) return;
    const tmp: Task = {
      id: `tmp-${Date.now()}`, projectId: activeId, title: newTask.trim(), status: 'todo', assignedTo: [],
      configuration: { priority: 'medium', description: '', tags: [], customFields: {} }, dependencies: [], version: 1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    setTasks((items) => [tmp, ...items]);
    const title = newTask.trim(); setNewTask('');
    try {
      const saved = await api.createTask(activeId, { title });
      setTasks((items) => [saved, ...items.filter((t) => t.id !== tmp.id && t.id !== saved.id)]);
      setSelectedId(saved.id); setSettingsOpen(false); setNotice('');
    } catch (e) {
      setTasks((items) => items.filter((t) => t.id !== tmp.id));
      setNotice((e as Error).message);
    }
  }

  async function loadMore() {
    if (!activeId || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.tasks(activeId, cursor);
      setTasks((items) => [...items, ...page.items.filter((next) => !items.some((old) => old.id === next.id))]);
      setCursor(page.nextCursor);
    } finally { setLoadingMore(false); }
  }

  async function updateSelected(patch: Partial<Task>) {
    if (!selected) return;
    const before = selected;
    const optimistic: Task = { ...selected, ...patch, configuration: patch.configuration ?? selected.configuration, version: selected.version + 1, updatedAt: new Date().toISOString() };
    setTasks((items) => items.map((x) => x.id === selected.id ? optimistic : x));
    try {
      const saved = await api.updateTask(before, patch);
      setTasks((items) => items.map((x) => x.id === saved.id ? saved : x));
      setNotice('');
    } catch (e: any) {
      const current = e.current as Task | undefined;
      setTasks((items) => items.map((x) => x.id === selected.id ? (current || before) : x));
      setNotice(e.message);
    }
  }

  async function deleteSelected() {
    if (!selected) return;
    const before = selected;
    setTasks((items) => items.filter((x) => x.id !== selected.id));
    setSelectedId(undefined);
    try { await api.deleteTask(selected.id); setNotice(''); }
    catch (e: any) { setTasks((items) => [before, ...items]); setSelectedId(before.id); setNotice(e.message); }
  }

  return <main className="app-shell">
    <header>
      <div><div className="brand">HAPPYROBOT / COLLABORATIVE TASK SYSTEM</div><h1>Realtime Task Control</h1></div>
      <div className={`live-pill ${projectRealtime === 'polling' ? 'fallback' : ''}`}><span />{realtimeLabel}</div>
    </header>
    {notice && <div className="notice" role="alert" data-testid="app-notice" onClick={() => setNotice('')}>{notice} <b>×</b></div>}

    <div className="workspace">
      <aside className="projects">
        <div className="eyebrow">PROJECTS</div>
        <form onSubmit={createProject} className="project-create">
          <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Project name" aria-label="Project name" />
          <textarea rows={2} value={projectDescription} onChange={(e) => setProjectDescription(e.target.value)} placeholder="Short description" aria-label="Project description" />
          <button>Create project</button>
        </form>
        <div className="project-stack">
          {projects.map((p) => <button key={p.id} className={`project ${activeId === p.id ? 'active' : ''}`} onClick={() => setActiveId(p.id)}>
            <b>{p.name}</b><span>{p.description || 'Collaborative workspace'}</span><small>v{p.version}</small>
          </button>)}
          {projects.length === 0 && <div className="small-empty">No projects yet.</div>}
        </div>
      </aside>

      <section className="board">
        <div className="board-head">
          <div><div className="eyebrow">ACTIVE PROJECT</div><h2>{active?.name || 'Create a project'}</h2>{active?.description && <p>{active.description}</p>}</div>
          <div className="board-actions"><span>{tasks.length} loaded</span>{active && <button className="secondary" onClick={() => void openProjectSettings()}>Project settings</button>}</div>
        </div>
        {active && <form onSubmit={createTask} className="new-task"><input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Add a task and press Enter" /><button>Add task</button></form>}
        {active ? <TaskList tasks={tasks} selectedId={selectedId} onSelect={(task) => { setSelectedId(task.id); setSettingsOpen(false); }} onLoadMore={loadMore} hasMore={!!cursor} /> : <div className="empty">Create a project to start.</div>}
      </section>

      {settingsOpen && active ? <ProjectSettings project={active} onSave={updateActiveProject} onClose={() => setSettingsOpen(false)} />
        : selected ? <TaskDetail task={selected} allTasks={tasks} onUpdate={updateSelected} onDelete={deleteSelected} liveComments={liveComments} />
          : <aside className="detail empty-detail"><div><div className="eyebrow">DETAIL PANEL</div><h2>Select a task</h2><p>Edit status, priority, dependencies, custom fields, and comments. Open another browser window on the same project to see entity-level updates without refreshing.</p><button className="secondary" disabled={!active} onClick={() => void openProjectSettings()}>Edit project metadata</button></div></aside>}
    </div>

    <footer><span>Optimistic UI + rollback</span><span>Versioned writes</span><span>Append-only event log</span><span>Cursor pagination</span><span>Virtualized list</span><span>SSE + durable polling fallback</span></footer>
  </main>;
}
