import { NavLink } from 'react-router-dom';
import { Eye, Users, FileText, Activity, AlertTriangle, Settings } from 'lucide-react';
import clsx from 'clsx';
import { Logo } from '../ui/Logo';

interface NavItem {
  to: string;
  label: string;
  icon: JSX.Element;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Live Feed', icon: <Activity size={18} />, end: true },
  { to: '/agents', label: 'Agents', icon: <Users size={18} /> },
  { to: '/policies', label: 'Policies', icon: <FileText size={18} /> },
  { to: '/audit', label: 'Audit', icon: <Eye size={18} /> },
  { to: '/alerts', label: 'Alerts', icon: <AlertTriangle size={18} /> },
  { to: '/settings', label: 'Settings', icon: <Settings size={18} /> },
];

interface SidebarProps {
  onNavigate?: () => void;
  /** Mobile drawer open state (controlled by App on small screens). */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ onNavigate, mobileOpen = false, onMobileClose }: SidebarProps): JSX.Element {
  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          aria-hidden
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onMobileClose}
        />
      )}
      <aside
        className={clsx(
          'w-60 shrink-0 bg-surface border-r border-border h-full flex flex-col',
          // Mobile: slide-in drawer; md+: always visible
          'fixed md:static inset-y-0 left-0 z-50 md:z-auto transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div className="px-md py-lg border-b border-border">
          <Logo size={28} />
        </div>
        <nav className="flex-1 px-sm py-md space-y-0.5" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => {
                onNavigate?.();
                onMobileClose?.();
              }}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 px-sm py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-text-muted hover:bg-border/40 hover:text-text',
                )
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-md py-md border-t border-border text-xs text-text-muted font-mono">
          v0.1.0 · build #local
        </div>
      </aside>
    </>
  );
}

export default Sidebar;