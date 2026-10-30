export async function probePin(pinUrl: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    await fetchImpl(pinUrl, { method: "GET", signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}
