"use client";
import Link from "next/link";

// A thin page rendering a section component that owns the links.
export function BillingSection() {
  return (
    <section>
      <h1>Billing</h1>
      <Link href="/home/tokens">Manage tokens</Link>
    </section>
  );
}
