'use client';
import { useMemo } from 'react';

function valueToString(value: unknown) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export default function CustomFieldsEditor({ value, onChange }: {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => Promise<void>;
}) {
  const rows = useMemo(() => Object.entries(value || {}), [value]);

  const updateKey = (oldKey: string, newKey: string) => {
    const key = newKey.trim();
    if (!key || key === oldKey) return;
    const next = { ...value };
    const current = next[oldKey];
    delete next[oldKey];
    next[key] = current;
    void onChange(next);
  };
  const updateValue = (key: string, nextValue: string) => void onChange({ ...value, [key]: nextValue });
  const remove = (key: string) => {
    const next = { ...value };
    delete next[key];
    void onChange(next);
  };
  const add = () => {
    let i = 1;
    let key = 'field';
    while (key in value) key = `field${++i}`;
    void onChange({ ...value, [key]: '' });
  };

  return <div className="custom-fields">
    <div className="label-row"><div className="label-title">Custom fields</div><button type="button" className="tiny secondary" onClick={add}>+ Add field</button></div>
    {rows.length === 0 && <div className="small-empty bordered">No custom fields yet.</div>}
    {rows.map(([key, fieldValue]) => <div className="custom-field-row" key={key}>
      <input aria-label="Custom field key" defaultValue={key} onBlur={(e) => updateKey(key, e.target.value)} />
      <input aria-label={`Custom field ${key}`} defaultValue={valueToString(fieldValue)} onBlur={(e) => { if (e.target.value !== valueToString(fieldValue)) updateValue(key, e.target.value); }} />
      <button type="button" className="icon-button danger" onClick={() => remove(key)} aria-label={`Remove ${key}`}>×</button>
    </div>)}
    <p className="helper">Values are stored in the task configuration JSONB and transmitted only with the task delta.</p>
  </div>;
}
