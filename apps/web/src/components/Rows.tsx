import type { ReactNode } from "react";

export function Rows({ children }: { children: ReactNode }) {
  return <dl className="rows">{children}</dl>;
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
