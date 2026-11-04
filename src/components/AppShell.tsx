import { Activity, FileText, LoaderCircle, ScanLine, ShieldCheck } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { PropsWithChildren } from 'react';

export function AppShell({ children }: PropsWithChildren) {
  return <div className="app-shell">
    <header className="topbar">
      <NavLink to="/documents" className="brand"><span className="brand-mark"><ScanLine size={16} /></span><span>OCR Review</span></NavLink>
      <div className="actor"><span className="actor-dot" />Demo reviewer</div>
    </header>
    <div className="shell-body">
      <aside className="sidebar">
        <p className="nav-label">Workspace</p>
        <NavLink to="/documents" className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}><FileText size={16} />Documents</NavLink>
        <a className="nav-item" href="/documents?status=processing"><LoaderCircle size={16} />Processing</a>
        <a className="nav-item" href="/documents?status=draft"><ShieldCheck size={16} />Drafts</a>
        <p className="nav-label nav-spaced">System</p>
        <NavLink to="/documents/activity" className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}><Activity size={16} />Activity</NavLink>
      </aside>
      <main className="content">{children}</main>
    </div>
  </div>;
}
