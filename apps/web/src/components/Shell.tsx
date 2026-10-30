import { NavLink, Outlet, useMatch } from "react-router-dom";

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/register", label: "Register", end: false },
  { to: "/custody", label: "Custody", end: false },
  { to: "/recall", label: "Recall", end: false },
];

export function Shell() {
  const verifying = useMatch("/verify/:chainId/:contractAddress/:batchCode");
  return (
    <div className="wrap">
      <header className="site-header">
        <div>
          <p className="brand">PROOFCHAIN</p>
          <p className="brand-note">Shared custody log</p>
        </div>
        <nav aria-label="Primary">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end}>
              {link.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main>
        {verifying ? <p className="muted">Public verification does not use a wallet.</p> : null}
        <Outlet />
      </main>
    </div>
  );
}
