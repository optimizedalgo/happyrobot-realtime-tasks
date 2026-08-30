'use client';
import { FormEvent, useEffect, useState } from 'react';
import type { Project } from '@/lib/types';

export default function ProjectSettings({ project, onSave, onClose }: {
  project: Project;
  onSave: (patch: Partial<Pick<Project, 'name' | 'description' | 'metadata'>>) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [metadata, setMetadata] = useState(JSON.stringify(project.metadata || {}, null, 2));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
    setMetadata(JSON.stringify(project.metadata || {}, null, 2));
    setError('');
  }, [project.id, project.version]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    let parsed: Record<string, unknown>;
    try { parsed = metadata.trim() ? JSON.parse(metadata) : {}; }
    catch { setError('Metadata must be valid JSON.'); return; }
    if (!name.trim()) { setError('Project name is required.'); return; }
    setSaving(true); setError('');
    try { await onSave({ name: name.trim(), description: description.trim(), metadata: parsed }); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  return <aside className="detail">
    <div className="detail-head"><div><div className="eyebrow">PROJECT SETTINGS</div><h2>{project.name}</h2><div className="version-line">version {project.version}</div></div><button className="ghost" onClick={onClose}>Close</button></div>
    <form onSubmit={submit} className="project-settings-form">
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Description<textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this project for?" /></label>
      <label>Metadata JSON<textarea className="code-input" rows={10} value={metadata} onChange={(e) => setMetadata(e.target.value)} spellCheck={false} /></label>
      <p className="helper">Metadata is fetched only when this detail panel opens; project list responses intentionally omit it so a future 2MB+ project payload is never rebroadcast.</p>
      {error && <div className="field-error">{error}</div>}
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save project'}</button>
    </form>
  </aside>;
}
