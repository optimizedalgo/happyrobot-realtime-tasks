'use client';
import { useMemo, useState } from 'react';
import type { Task } from '@/lib/types';

const ROW=82, HEIGHT=560, OVER=5;
export default function TaskList({tasks,selectedId,onSelect,onLoadMore,hasMore}:{tasks:Task[];selectedId?:string;onSelect:(t:Task)=>void;onLoadMore:()=>void;hasMore:boolean}){
  const [scrollTop,setScrollTop]=useState(0);
  const start=Math.max(0,Math.floor(scrollTop/ROW)-OVER);
  const visible=Math.ceil(HEIGHT/ROW)+OVER*2;
  const slice=useMemo(()=>tasks.slice(start,start+visible),[tasks,start,visible]);
  return <div className="task-list-shell">
    <div className="task-list" style={{height:HEIGHT}} onScroll={e=>{const el=e.currentTarget;setScrollTop(el.scrollTop); if(hasMore && el.scrollHeight-el.scrollTop-el.clientHeight<240) onLoadMore();}}>
      <div style={{height:tasks.length*ROW,position:'relative'}}>
        {slice.map((t,i)=>{
          const idx=start+i;
          return <button key={t.id} className={`task-row ${selectedId===t.id?'selected':''}`} style={{top:idx*ROW,height:ROW-8}} onClick={()=>onSelect(t)}>
            <div className="task-row-main"><span className="task-title">{t.title}</span><span className={`status s-${t.status}`}>{t.status.replace('_',' ')}</span></div>
            <div className="task-row-meta"><span>{t.configuration.priority} priority</span><span>v{t.version}</span><span>{t.dependencies.length} deps</span></div>
          </button>
        })}
      </div>
    </div>
    {hasMore && <button className="secondary load-more" onClick={onLoadMore}>Load more tasks</button>}
  </div>
}
