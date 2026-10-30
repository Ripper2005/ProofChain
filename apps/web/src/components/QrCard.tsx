import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { originIsLoopback } from "../lib/format.ts";

export function QrCard({ url, batchCode }: { url: string; batchCode: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: "#141414", light: "#fffdf8" },
    })
      .then((value: string) => {
        if (!cancelled) setDataUrl(value);
      })
      .catch(() => {
        if (!cancelled) setError("The QR image could not be generated.");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  function download() {
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${batchCode}.png`;
    link.click();
  }

  return (
    <div className="stack">
      <p className="mono" data-testid="verification-url">
        {url}
      </p>
      {originIsLoopback(url) ? (
        <p className="warning" data-testid="loopback-warning">
          A phone cannot open this QR. The origin is localhost or 127.0.0.1, which means the phone itself, not this
          computer. Type this computer&apos;s LAN address, or a tunnel origin, before printing.
        </p>
      ) : null}
      {error ? <p className="revert">{error}</p> : null}
      {dataUrl ? <img className="qr" src={dataUrl} alt={`QR code for ${batchCode}`} /> : <p>Generating the QR image.</p>}
      <button type="button" onClick={download} disabled={!dataUrl}>
        Download PNG
      </button>
    </div>
  );
}
