'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Comment, Priority, Status, Task } from '@/lib/types';
import DependencyPicker from './DependencyPicker';
import CustomFieldsEditor from './CustomFieldsEditor';

const statuses: Status[] = ['todo', 'in_progress', 'blocked', 'done'];
const priorities: Priority[] = ['low', 'medium', 'high', 'urgent'];

export default function TaskDetail({ task, allTasks, onUpdate, onDelete, liveComments }: {
  task: Task;
  allTasks: Task[];
  onUpdate: (patch: Partial<Task>) => Promise<void>;
  onDelete: () => Promise<void>;
  liveComments?: Comment[];
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [content, setContent] = useState('');
  const [author, setAuthor] = useState('Demo User');
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descriptionDraft, setDescriptionDraft] = useState(task.configuration.description);

  useEffect(() => {
    api.comments(task.id).then(setComments).catch(() => setComments([]));
    setTitleDraft(task.title);
    setDescriptionDraft(task.configuration.description);
  }, [task.id]);
  useEffect(() => { setTitleDraft(task.title); setDescriptionDraft(task.configuration.description); }, [task.title, task.configuration.description]);
  useEffect(() => {
    const incoming = (liveComments || []).filter((comment) => comment.taskId === task.id);
    if (incoming.length === 0) return;
    setComments((current) => {
      const known = new Set(current.map((comment) => comment.id));
      return [...current, ...incoming.filter((comment) => !known.has(comment.id))].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    });
  }, [liveComments, task.id]);

  async function addComment(e: FormEvent) {
    e.preventDefault();
    if (!content.trim() || !author.trim()) return;
    const optimistic: Comment = { id: `tmp-${Date.now()}`, taskId: task.id, content: content.trim(), author: author.trim(), timestamp: new Date().toISOString() };
    setComments((current) => [...current, optimistic]);
    const text = content.trim();
    setContent('');
    try {
      const saved = await api.createComment(task.id, { content: text, author: author.trim() });
      setComments((current) => [...current.filter((x) => x.id !== optimistic.id && x.id !== saved.id), saved].sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
    } catch {
      setComments((current) => current.filter((x) => x.id !== optimistic.id));
      setContent(text);
    }
  }

  return <aside className="detail">
    <div className="detail-head">
      <div><div className="eyebrow">TASK DETAILS</div><h2>{task.title}</h2><div className="version-line">version {task.version} · {new Date(task.updatedAt).toLocaleString()}</div></div>
      <button className="danger ghost" onClick={() => { if (window.confirm(`Delete “${task.title}”?`)) void onDelete(); }}>Delete</button>
    </div>

    <label>Title<input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onBlur={() => { if (titleDraft.trim() && titleDraft !== task.title) void onUpdate({ title: titleDraft.trim() }); }} /></label>
    <div className="two-col">
      <label>Status<select value={task.status} onChange={(e) => void onUpdate({ status: e.target.value as Status })}>{statuses.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></label>
      <label>Priority<select value={task.configuration.priority} onChange={(e) => void onUpdate({ configuration: { ...task.configuration, priority: e.target.value as Priority } })}>{priorities.map((p) => <option key={p}>{p}</option>)}</select></label>
    </div>

    <label>Description<textarea rows={4} value={descriptionDraft} onChange={(e) => setDescriptionDraft(e.target.value)} onBlur={() => { if (descriptionDraft !== task.configuration.description) void onUpdate({ configuration: { ...task.configuration, description: descriptionDraft } }); }} /></label>
    <div className="two-col">
      <label>Assignees<input key={`assignees-${task.id}-${task.version}`} defaultValue={task.assignedTo.join(', ')} onBlur={(e) => {
        const assignedTo = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
        if (JSON.stringify(assignedTo) !== JSON.stringify(task.assignedTo)) void onUpdate({ assignedTo });
      }} placeholder="alex, sam" /></label>
      <label>Tags<input key={`tags-${task.id}-${task.version}`} defaultValue={task.configuration.tags.join(', ')} onBlur={(e) => {
        const tags = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
        if (JSON.stringify(tags) !== JSON.stringify(task.configuration.tags)) void onUpdate({ configuration: { ...task.configuration, tags } });
      }} placeholder="backend, urgent" /></label>
    </div>

    <CustomFieldsEditor value={task.configuration.customFields} onChange={(customFields) => onUpdate({ configuration: { ...task.configuration, customFields } })} />
    <DependencyPicker task={task} loadedTasks={allTasks} onChange={(dependencies) => onUpdate({ dependencies })} />

    <div className="comments">
      <div className="label-title">Comments · realtime</div>
      <div className="comment-thread">
        {comments.length === 0 && <div className="small-empty">No comments yet.</div>}
        {comments.map((c) => <div className="comment" key={c.id}><b>{c.author}</b><span>{c.content}</span><time>{new Date(c.timestamp).toLocaleTimeString()}</time></div>)}
      </div>
      <form onSubmit={addComment}>
        <div className="two-col"><input aria-label="Author" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name" /><input aria-label="Comment" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write a comment…" /></div>
        <button type="submit">Comment</button>
      </form>
    </div>
  </aside>;
}
