"use client";
import Link from "next/link";
import type { ReactNode } from "react";

// A nav table: the href literals live in the array, not in the JSX attribute.
const NAV = [
  { href: "/home", label: "Home" },
  { href: "/home/billing", label: "Billing" },
];

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div>
      <nav>
        {NAV.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
        <Link href="/home/tokens">Tokens</Link>
      </nav>
      {children}
    </div>
  );
}
