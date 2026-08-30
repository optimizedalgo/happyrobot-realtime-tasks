import type { Comment, EventDelta, Page, Project, ProjectPage, Task } from './types';

// Empty base URL means same-origin /api on Vercel Services. Docker Compose injects localhost:8080.
export const API = process.env.NEXT_PUBLIC_API_URL || '';

type ApiError = Error & { status?: number; current?: Task | Project };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const e = new Error(body.error || res.statusText) as ApiError;
    e.status = res.status;
    e.current = body.current;
    throw e;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  health: () => request<{ status: string; database: string }>('/health'),
  projects: () => request<ProjectPage>('/api/projects'),
  project: (id: string) => request<Project>(`/api/projects/${id}`),
  createProject: (v: { name: string; description?: string; metadata?: Record<string, unknown> }) =>
    request<Project>('/api/projects', { method: 'POST', body: JSON.stringify(v) }),
  updateProject: (project: Project, patch: Partial<Pick<Project, 'name' | 'description' | 'metadata'>>) =>
    request<Project>(`/api/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ ...patch, version: project.version }) }),
  tasks: (projectId: string, cursor = '', limit = 100, search = '') =>
    request<Page<Task>>(`/api/projects/${projectId}/tasks?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  searchTasks: (projectId: string, search: string, limit = 20) =>
    request<Page<Task>>(`/api/projects/${projectId}/tasks?limit=${limit}&search=${encodeURIComponent(search)}`),
  createTask: (projectId: string, v: Partial<Task> & { title: string }) =>
    request<Task>(`/api/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(v) }),
  updateTask: (task: Task, patch: Partial<Pick<Task, 'title' | 'status' | 'assignedTo' | 'configuration' | 'dependencies'>>) =>
    request<Task>(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ ...patch, version: task.version }) }),
  deleteTask: (id: string) => request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
  comments: (taskId: string) => request<Comment[]>(`/api/tasks/${taskId}/comments`),
  createComment: (taskId: string, v: { content: string; author: string }) =>
    request<Comment>(`/api/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify(v) }),
  deltas: (args: { projectId?: string; scope?: 'projects'; after: number }) => {
    const query = args.scope === 'projects'
      ? `scope=projects&after=${args.after}`
      : `projectId=${encodeURIComponent(args.projectId || '')}&after=${args.after}`;
    return request<{ items: EventDelta[]; nextCursor: number }>(`/api/event-deltas?${query}`);
  },
};
