import type { SVGProps } from 'react';

export function DartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" {...props}>
      <path d="m9 39 19-23 3 3-19 23-5 3 2-6Z" fill="currentColor" />
      <path d="m27 17 1-10 6-5 1 12-8 3Zm4 2 10-2 5-7-12 3-3 6Z" fill="currentColor" />
      <path d="m17 30 5 4m-3-7 5 4m-3-7 5 4" stroke="var(--bt-bg-primary)" strokeWidth="1.2" />
    </svg>
  );
}
export function CrossedDarts(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 3 5 12l7 8 5 1 22 25 2-2L19 19l-1-6L10 5 7 3Zm34 0 2 9-7 8-5 1L9 46l-2-2 22-25 1-6 8-8 3-2Z"
        fill="currentColor"
      />
      <path d="m7 6 9 12M41 6l-9 12" stroke="var(--bt-accent-primary)" strokeWidth="1" />
    </svg>
  );
}
