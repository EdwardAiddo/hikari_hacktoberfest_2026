import { useState } from "react";
import logo from "../assets/hikari-logo.svg";

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="site-header">
      <img src={logo} className="brand-logo" width={40} height={40} />
      <span className="brand-name">Hikari Notes</span>
      <button className="menu-toggle" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      {open && (
        <nav className="site-nav">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
        </nav>
      )}
    </header>
  );
}
