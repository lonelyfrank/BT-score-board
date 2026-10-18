import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

/** Single dart: navigation, banner del turno, CTA. */
export function DartIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 21l9-9" />
      <path d="M12 12l2.2-6.5 1.8 2.3 2.8-.6-1.6 2.4 2.3 1.8z" />
    </svg>
  );
}
export function CrossedDarts(props: IconProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 40 L30 18" />
      <path d="M30 18 l3 -9 l3 4 l5 -1 l-3 4 l4 3 l-9 3 z" fill="currentColor" />
      <path d="M40 40 L18 18" />
      <path d="M18 18 l-3 -9 l-3 4 l-5 -1 l3 4 l-4 3 l9 3 z" fill="currentColor" />
      <path d="M11 37 l3 3 M37 37 l-3 3" />
    </svg>
  );
}
export function CrowdIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <circle cx="12" cy="7" r="3.2" />
      <circle cx="5" cy="9" r="2.4" />
      <circle cx="19" cy="9" r="2.4" />
      <path d="M6.5 20c0-3.6 2.5-6.5 5.5-6.5s5.5 2.9 5.5 6.5z" />
      <path d="M1 19c0-2.8 1.8-5 4-5 1 0 1.9.4 2.6 1.1C6.4 16.2 5.6 17.8 5.4 19z" />
      <path d="M23 19c0-2.8-1.8-5-4-5-1 0-1.9.4-2.6 1.1 1.2 1.1 2 2.7 2.2 3.9z" />
    </svg>
  );
}
export function CheersIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3.5 6.5 9 5.2l1.6 11.2a2 2 0 0 1-1.6 2.2l-1.7.3a2 2 0 0 1-2.3-1.6z" />
      <path d="M3.9 9.3 9.5 8" />
      <path d="M20.5 6.5 15 5.2l-1.6 11.2a2 2 0 0 0 1.6 2.2l1.7.3a2 2 0 0 0 2.3-1.6z" />
      <path d="M20.1 9.3 14.5 8" />
      <path d="M10.5 2.5 11 4M13.5 2.5 13 4M12 1.5v2" />
    </svg>
  );
}
export function CrownIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 18" aria-hidden="true" {...props}>
      <path d="M2 3l4 11h12l4-11-6 5-4-7-4 7z" fill="var(--bt-warning)" />
    </svg>
  );
}
/** Coppa con freccetta: intestazione evento. */
export function TrophyEmblem(props: IconProps) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" {...props}>
      <circle cx="32" cy="32" r="30" fill="#141416" stroke="#F8F7F5" strokeWidth="2" />
      <path d="M21 16h22v10a11 11 0 0 1-22 0z" fill="#F8F7F5" />
      <path
        d="M21 19h-5a5 5 0 0 0 5 8M43 19h5a5 5 0 0 1-5 8"
        fill="none"
        stroke="#F8F7F5"
        strokeWidth="2.4"
      />
      <path d="M29 37h6v6h-6zM24 47h16v4H24z" fill="#F8F7F5" />
      <path d="M10 52 30 30" stroke="#FF238B" strokeWidth="3" strokeLinecap="round" />
      <path d="M30 30l2-7 2 3 4-1-2 3 3 2z" fill="#FF238B" />
    </svg>
  );
}
/** Macchia di vernice dietro la carta del punteggio. */
export function PaintSplash(props: IconProps) {
  return (
    <svg viewBox="0 0 250 160" preserveAspectRatio="none" aria-hidden="true" {...props}>
      <path
        d="M20 30c30-25 80-10 120-22s80 8 95 30-5 45 10 70-20 55-60 50-70 10-110-2S0 120 6 90s-10-45 14-60z"
        fill="#FF238B"
        opacity=".9"
      />
      <circle cx="236" cy="22" r="5" fill="#FF238B" />
      <circle cx="12" cy="148" r="4" fill="#FF238B" />
      <circle cx="228" cy="150" r="3" fill="#FF238B" />
    </svg>
  );
}
