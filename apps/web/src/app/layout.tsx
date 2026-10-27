import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
export const metadata: Metadata = {title:'SuperApp — Mobilidade + Food',description:'Fundação demonstrativa do superapp de mobilidade e delivery.'};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body><header className="topbar"><Link href="/" className="brand"><span className="mark">S</span><span>Super<span className="text-accent">App</span></span></Link><nav className="nav"><Link href="/rides">Corridas</Link><Link href="/food">Delivery</Link><Link href="/partners">Parceiros</Link><Link href="/login" className="nav-cta">Entrar</Link></nav></header>{children}<footer className="footer"><span>© 2026 SuperApp • Fundação Sprint 01</span><span>Ambiente demonstrativo — nenhuma compra ou corrida é solicitada.</span></footer></body></html>;
}
