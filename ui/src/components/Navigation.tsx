import { cn } from '@/lib/utils';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Bot, 
  FileText, 
  BarChart3, 
  Cpu,
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/agents', icon: Bot, label: 'Agents' },
  { to: '/contracts', icon: FileText, label: 'Treasury Management' },
  { to: '/risk', icon: BarChart3, label: 'Risk & Analytics' },
];

interface NavigationProps {
  className?: string;
}

export function Navigation({ className }: NavigationProps) {
  return (
    <nav className={cn('flex items-center justify-between', className)}>
      <div className="flex items-center">
        <div className="flex items-center gap-3 mr-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-agent-treasury flex items-center justify-center">
            <Cpu size={20} className="text-background" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-none">AgentFlow</h1>
            <p className="text-xs text-muted-foreground">Procurement AI</p>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-muted/50 rounded-xl p-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                  )
                }
              >
                <Icon size={16} />
                <span className="hidden md:inline">{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </div>

      <ThemeToggle />
    </nav>
  );
}
