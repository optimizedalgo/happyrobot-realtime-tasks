export type Status = 'todo' | 'in_progress' | 'blocked' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export type Project = {
  id: string;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type Configuration = {
  priority: Priority;
  description: string;
  tags: string[];
  customFields: Record<string, unknown>;
};

export type Task = {
  id: string;
  projectId: string;
  title: string;
  status: Status;
  assignedTo: string[];
  configuration: Configuration;
  dependencies: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type Comment = {
  id: string;
  taskId: string;
  content: string;
  author: string;
  timestamp: string;
};

export type Page<T> = { items: T[]; nextCursor: string; syncCursor: number };
export type ProjectPage = { items: Project[]; syncCursor: number };
export type EventDelta = {
  id: number;
  projectId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  createdAt: string;
};
