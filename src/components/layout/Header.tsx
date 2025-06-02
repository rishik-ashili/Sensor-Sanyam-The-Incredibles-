
import Link from 'next/link';
import { MountainIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConnectionStatusIndicator from '@/components/dashboard/ConnectionStatusIndicator';

export default function Header() {
  return (
    <header className="bg-card shadow-sm sticky top-0 z-40 border-b border-border">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-primary hover:text-primary/90 transition-colors">
          <MountainIcon className="h-6 w-6" />
          <span className="text-xl font-semibold font-headline">SensorFlow Dashboard</span>
        </Link>
        <nav className="flex items-center gap-4">
          <Button variant="ghost" asChild>
            <Link href="/">Dashboard</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/settings">Settings</Link>
          </Button>
          <ConnectionStatusIndicator /> 
        </nav>
      </div>
    </header>
  );
}
