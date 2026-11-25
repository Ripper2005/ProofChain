import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation, useMatch } from "react-router-dom";
import { configurationErrors, writeTarget } from "../lib/deployments.ts";

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/register", label: "Register", end: false },
  { to: "/custody", label: "Custody", end: false },
  { to: "/recall", label: "Recall", end: false },
];

export function Shell() {
  const { pathname } = useLocation();
  const verifyMatch = useMatch("/verify/:chainId/:contractAddress/:batchCode");
  const target = writeTarget();
  const envLabel =
    target.kind === "ready" ? `${target.deployment.label} (${target.deployment.chainId})` : "Read-only mode";

  useEffect(() => {
    const batch = verifyMatch?.params.batchCode ? decodeURIComponent(verifyMatch.params.batchCode) : null;
    const prefix =
      pathname === "/"
        ? "Home"
        : pathname.startsWith("/register")
          ? "Register Batch"
          : pathname.startsWith("/custody")
            ? "Custody Handoff"
            : pathname.startsWith("/recall")
              ? "Batch Recall"
              : batch
                ? `Verify ${batch}`
                : "Verification";
    document.title = `${prefix} | ProofChain`;
  }, [pathname, verifyMatch]);

  return (
    <div className="wrap">
      <header className="site-header">
        <a href="#main-content" className="skip-link visually-hidden">
          Skip to main content
        </a>
        <div>
          <div className="brand-row">
            <Link className="brand" to="/">
              PROOFCHAIN
            </Link>
            <span className="env-pill">{envLabel}</span>
          </div>
          <p className="brand-note">Shared custody log for product batches</p>
        </div>
        <nav className="site-nav" aria-label="Primary">
          <ul>
            {links.map((link) => (
              <li key={link.to}>
                <NavLink to={link.to} end={link.end}>
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main-content" tabIndex={-1} className="stack">
        {configurationErrors().map((error) => (
          <p key={error} className="warning" role="alert" data-testid="configuration-error">
            {error}
          </p>
        ))}
        {verifyMatch ? (
          <p className="notice">Public verification reads Ethereum and IPFS directly — no wallet is required.</p>
        ) : null}
        <Outlet />
      </main>
      <footer className="site-footer">
        <p>
          ProofChain records signed custody claims and document commitments on Ethereum. It does not verify physical
          goods or manufacturer identity outside the signing wallet.
        </p>
      </footer>
    </div>
  );
}
