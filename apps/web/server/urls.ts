export function stripMount(url: string, mount: string): string | null {
  const hash = url.indexOf("#");
  const withoutHash = hash === -1 ? url : url.slice(0, hash);
  const queryAt = withoutHash.indexOf("?");
  const path = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt);
  const query = queryAt === -1 ? "" : withoutHash.slice(queryAt);
  let suffix: string;
  if (path === mount) suffix = "/";
  else if (path.startsWith(`${mount}/`)) suffix = path.slice(mount.length);
  else return null;
  if (!isSafePath(suffix)) return null;
  return `${suffix}${query}`;
}

export function joinUrl(base: string, pathAndQuery: string): string {
  const origin = base.endsWith("/") ? base : `${base}/`;
  const relative = pathAndQuery.replace(/^\//, "");
  return new URL(relative, origin).toString();
}

export function ipfsCid(url: string): string | null {
  const path = url.split("?")[0]?.split("#")[0] ?? "";
  const match = /^\/ipfs\/([^/]+)$/.exec(path);
  if (!match?.[1]) return null;
  let cid: string;
  try {
    cid = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (cid.length < 1 || cid.length > 128) return null;
  if (cid.includes("..") || cid.includes("/") || cid.includes("\\")) return null;
  for (let i = 0; i < cid.length; i += 1) {
    const code = cid.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) return null;
  }
  return cid;
}

function isSafePath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (decoded.includes("..") || decoded.includes("\\") || decoded.includes("//")) return false;
  return true;
}
