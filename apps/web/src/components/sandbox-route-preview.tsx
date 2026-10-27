'use client';

import { CarFront, Flag, MapPin } from 'lucide-react';

export type RoutePreviewRide = {
  status: 'REQUESTED' | 'OFFERED' | 'ACCEPTED' | 'ARRIVING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED' | 'EXPIRED';
  progressStep: number;
  pickupLabel: string;
  dropoffLabel: string;
};

export function sandboxRoutePercent(status: RoutePreviewRide['status'], step: number): number {
  const progressStep = Math.max(0, Math.min(5, Number.isFinite(step) ? step : 0));
  if (status === 'COMPLETED') return 100;
  if (status === 'IN_PROGRESS') return 50 + progressStep * 10;
  if (status === 'ARRIVING') return progressStep * 10;
  return 0;
}

export function SandboxRoutePreview({ ride }: { ride: RoutePreviewRide }) {
  if (!['ACCEPTED', 'ARRIVING', 'IN_PROGRESS', 'COMPLETED'].includes(ride.status)) return null;
  const progress = sandboxRoutePercent(ride.status, ride.progressStep);
  return <section className="sandbox-route-preview" aria-label="Trajeto ilustrativo, sem mapa ou GPS">
    <div className="sandbox-route-header">
      <strong><CarFront size={17}/> Acompanhamento fictício</strong>
      <span>{progress}% do roteiro esquemático</span>
    </div>
    <div className="sandbox-route-track">
      <div className="sandbox-route-fill" style={{ width: `${progress}%` }}/>
      <span className="sandbox-route-middle"><MapPin size={19}/></span>
      <span className="sandbox-route-car" style={{ left: `${progress}%` }}><CarFront size={19}/></span>
    </div>
    <div className="sandbox-route-stops">
      <span><CarFront size={15}/> Veículo</span>
      <span><MapPin size={15}/> {ride.pickupLabel}</span>
      <span><Flag size={15}/> {ride.dropoffLabel}</span>
    </div>
    <p className="partner-muted">Roteiro ilustrativo por etapas — não usa GPS, trânsito ou ETA real.</p>
  </section>;
}
