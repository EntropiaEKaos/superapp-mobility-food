import type { Metadata } from 'next';
import Link from 'next/link';
import { CarFront, UtensilsCrossed, UsersRound, CircleUserRound } from 'lucide-react';
import './globals.css';

export const metadata: Metadata = {
  title: 'SuperApp — Mobilidade + Food',
  description: 'Explore mobilidade e gastronomia na mesma cidade. Experiência demonstrativa.',
};
const links = [
  { href: '/rides', title: 'Corridas', icon: CarFront },
  { href: '/food', title: 'Delivery', icon: UtensilsCrossed },
  { href: '/partners', title: 'Parceiros', icon: UsersRound },
  { href: '/login', title: 'Conta', icon: CircleUserRound },
];
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>
    <a className="skip-to-content" href="#conteudo-principal">Pular para o conteúdo</a>
    <header className="topbar">
      <Link href="/" className="brand" aria-label="SuperApp, início">
        <span className="mark">S</span><span>Super<span className="text-accent">App</span></span>
      </Link>
      <nav className="nav" aria-label="Navegação principal">
        {links.map(({ href, title, icon: Icon }) =>
          <Link key={href} href={href} className={href === '/login' ? 'nav-cta' : undefined}>
            <Icon size={17} aria-hidden="true"/><span>{title}</span>
          </Link>)}
      </nav>
    </header>
    <div id="conteudo-principal">{children}</div>
    <footer className="footer">
      <span>© 2026 SuperApp · Cidade conectada</span>
      <span>Ambiente demonstrativo — sem corridas, pedidos ou cobranças reais.</span>
    </footer>
    <nav className="mobile-dock" aria-label="Navegação rápida">
      {links.map(({ href, title, icon: Icon }) =>
        <Link key={href} href={href}><Icon size={21} aria-hidden="true"/><span>{title}</span></Link>)}
    </nav>
  </body></html>;
}