import Link from 'next/link';
import {
  ArrowUpRight, CarFront, UtensilsCrossed, MapPinned, ShieldCheck,
  Navigation, ArrowRight, Clock3, Compass, Sparkles
} from 'lucide-react';

export default function Home() {
  return <main>
    <section className="hero wrap">
      <div className="hero-copy">
        <div className="eyebrow"><span className="pulse"/> TUDO O QUE MOVE SUA CIDADE</div>
        <h1>Mais cidade.<br/><span>Mais liberdade.</span></h1>
        <p className="hero-lead">Seu próximo trajeto ou sua próxima refeição. Descubra mobilidade e delivery em uma experiência feita para o dia a dia.</p>
        <div className="hero-actions">
          <Link href="/rides" className="btn primary"><CarFront size={20}/> Simular corrida <ArrowUpRight size={18}/></Link>
          <Link href="/food" className="btn secondary"><UtensilsCrossed size={19}/> Explorar delivery <ArrowRight size={18}/></Link>
        </div>
        <div className="trust"><ShieldCheck size={17}/> Ambiente de demonstração. Sem cobranças ou chamadas reais.</div>
      </div>
      <div className="hero-art" aria-label="Ilustração de uma rota urbana fictícia">
        <div className="city-card">
          <div className="city-card-top"><span>SEU DIA EM MOVIMENTO</span><span className="city-live"><i/> DEMO</span></div>
          <strong>Onde a cidade<br/>te leva hoje?</strong>
          <div className="route-diagram">
            <div className="route-stop"><i/> <span>Origem</span><b>Boqueirão</b></div>
            <div className="route-line"/>
            <div className="route-stop"><i/> <span>Destino</span><b>Ocian</b></div>
          </div>
          <div className="trip-status"><span><Navigation size={17}/> Simulação de trajeto</span><ArrowUpRight size={18}/></div>
        </div>
        <div className="floating-food"><UtensilsCrossed size={20}/><span>Seu próximo sabor está aqui</span></div>
      </div>
    </section>
    <section className="quick-start wrap" aria-label="Comece por aqui">
      <div><Clock3 size={19}/><span>Simples de explorar</span></div>
      <div><Compass size={19}/><span>Uma cidade, duas experiências</span></div>
      <div><Sparkles size={19}/><span>Feito para o seu dia</span></div>
    </section>
    <section className="features wrap">
      <div className="section-intro">
        <div className="eyebrow muted">ESCOLHA SEU PRÓXIMO PASSO</div>
        <h2>O que você quer fazer agora?</h2>
        <p>Uma única experiência para descobrir o que sua cidade tem a oferecer.</p>
      </div>
      <div className="service-grid">
        <Link className="service ride" href="/rides">
          <div className="service-top"><div className="service-icon"><CarFront size={30}/></div><span className="service-number">01 / MOBILIDADE</span></div>
          <div><span className="service-kicker">VÁ MAIS LONGE</span><h3>Seu próximo destino começa aqui.</h3><p>Explore rotas e compare valores em um simulador de corridas.</p></div>
          <span className="service-link">Explorar corridas <ArrowUpRight size={20}/></span>
        </Link>
        <Link className="service food" href="/food">
          <div className="service-top"><div className="service-icon"><UtensilsCrossed size={30}/></div><span className="service-number">02 / DELIVERY</span></div>
          <div><span className="service-kicker">DESCUBRA SABORES</span><h3>Seus favoritos, pertinho de você.</h3><p>Explore restaurantes e monte um carrinho demonstrativo.</p></div>
          <span className="service-link">Explorar delivery <ArrowUpRight size={20}/></span>
        </Link>
      </div>
    </section>
    <section className="how wrap">
      <div className="section-intro"><div className="eyebrow muted">UM ECOSSISTEMA EM CONSTRUÇÃO</div><h2>Conexões que fazem sentido.</h2></div>
      <div className="pillars">
        <div><MapPinned/><b>Uma plataforma local</b><p>Simule deslocamentos e conheça serviços da cidade em um só lugar.</p></div>
        <div><Navigation/><b>Experiência conectada</b><p>Uma base tecnológica preparada para incorporar recursos de operação real futuramente.</p></div>
        <div><ShieldCheck/><b>Teste com segurança</b><p>Nenhuma transação é executada nas experiências demonstrativas.</p></div>
      </div>
    </section>
  </main>;
}