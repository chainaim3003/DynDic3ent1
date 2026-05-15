import { ReactNode } from 'react';
import { Navigation } from './Navigation';
import { useSimulation } from '@/hooks/useSimulation';
import { cn } from '@/lib/utils';

interface LayoutProps {
  children: ReactNode;
  simulation: ReturnType<typeof useSimulation>;
}

export function Layout({ children, simulation }: LayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="container flex items-center justify-between h-16 px-4">
          <Navigation />
        </div>
      </header>

      {/* Main Content */}
      <main className="container px-4 py-6">
        {children}
      </main>
    </div>
  );
}
