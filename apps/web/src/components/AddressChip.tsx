import type { CSSProperties } from "react";
import { getAddress, isAddress } from "viem";

export function AddressChip({ address }: { address: string }) {
  if (!isAddress(address, { strict: false })) return <span className="mono">{address}</span>;
  const full = getAddress(address.toLowerCase());
  const short = `${full.slice(0, 6)}…${full.slice(-4)}`;
  const style = { "--chip": chipColor(full) } as CSSProperties;
  return (
    <details className="address-chip" style={style} data-testid="address-chip" data-address={full}>
      <summary>{short}</summary>
      <span className="address-full">{full}</span>
    </details>
  );
}

function chipColor(address: string): string {
  const hue = Number(BigInt(address) % 360n);
  return `hsl(${hue} 55% 24%)`;
}
