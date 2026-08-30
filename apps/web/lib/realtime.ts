'use client';
import { useEffect, useRef, useState } from 'react';
import { API, api } from './api';
import type { EventDelta } from './types';

export type RealtimeState = 'connecting' | 'live' | 'polling' | 'offline';
type Handler = (eventType: string, payload: any, eventId: string) => void;

function applyDelta(delta: EventDelta, onEvent: Handler) {
  onEvent(delta.eventType, delta.payload, String(delta.id));
}

function useDurableEvents(options: {
  streamPath?: string;
  projectId?: string;
  projectScope?: boolean;
  snapshotCursor?: number;
  eventTypes: string[];
  onEvent: Handler;
}) {
  const { streamPath, projectId, projectScope, snapshotCursor, eventTypes, onEvent } = options;
  const [state, setState] = useState<RealtimeState>('connecting');
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (snapshotCursor === undefined || (!projectId && !projectScope) || !streamPath) return;
    let stopped = false;
    let es: EventSource | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let cursor = snapshotCursor;
    let failures = 0;

    const dispatch = (type: string, payload: unknown, id: string) => {
      const n = Number(id);
      if (Number.isFinite(n)) cursor = Math.max(cursor, n);
      handlerRef.current(type, payload, id);
    };

    const poll = async () => {
      if (stopped) return;
      try {
        const page = await api.deltas(projectScope ? { scope: 'projects', after: cursor } : { projectId, after: cursor });
        for (const delta of page.items) applyDelta(delta, dispatch);
        cursor = Math.max(cursor, page.nextCursor || cursor);
        setState('polling');
      } catch {
        setState('offline');
      } finally {
        if (!stopped) pollTimer = setTimeout(poll, 1500);
      }
    };

    const connect = () => {
      setState('connecting');
      const sep = streamPath.includes('?') ? '&' : '?';
      es = new EventSource(`${API}${streamPath}${sep}lastEventId=${cursor}`);
      es.onopen = () => { failures = 0; setState('live'); };
      const listeners = eventTypes.map((type) => {
        const fn = (raw: Event) => {
          const e = raw as MessageEvent;
          try { dispatch(type, JSON.parse(e.data), e.lastEventId); } catch { /* ignore malformed frame */ }
        };
        es!.addEventListener(type, fn);
        return [type, fn] as const;
      });
      es.onerror = () => {
        failures += 1;
        // EventSource handles normal reconnects. If the platform repeatedly terminates a stream,
        // switch to durable 1.5s event-log polling so collaboration remains correct.
        if (failures >= 3 && es) {
          listeners.forEach(([t, f]) => es?.removeEventListener(t, f));
          es.close();
          es = undefined;
          setState('polling');
          void poll();
        } else {
          setState('connecting');
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      es?.close();
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [streamPath, projectId, projectScope, snapshotCursor, eventTypes.join('|')]);

  return state;
}

const projectEventTypes = ['task.created', 'task.updated', 'task.deleted', 'comment.created'];
const catalogEventTypes = ['project.created', 'project.updated'];

export function useProjectEvents(projectId: string | undefined, snapshotCursor: number | undefined, onEvent: Handler) {
  return useDurableEvents({
    streamPath: projectId ? `/api/events?projectId=${encodeURIComponent(projectId)}` : undefined,
    projectId,
    snapshotCursor,
    eventTypes: projectEventTypes,
    onEvent,
  });
}

export function useProjectCatalogEvents(snapshotCursor: number | undefined, onEvent: Handler) {
  return useDurableEvents({
    streamPath: '/api/project-events',
    projectScope: true,
    snapshotCursor,
    eventTypes: catalogEventTypes,
    onEvent,
  });
}
