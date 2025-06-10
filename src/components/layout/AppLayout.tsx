import type { ReactNode } from 'react';
import Header from './Header';

interface AppLayoutProps {
  children: ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <>
      <Header />
      <main className="flex-grow container mx-auto px-4 py-8">
        {children}
      </main>
      <footer className="py-4 text-center text-sm text-muted-foreground">
        <img src="/logo.png" alt="Dashboard Logo" className="h-10 w-auto inline-block align-middle drop-shadow-lg" /> &copy; {new Date().getFullYear()}
      </footer>
    </>
  );
}
