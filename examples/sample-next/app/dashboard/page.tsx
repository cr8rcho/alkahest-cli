"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

export default function Dashboard() {
  const { data } = useQuery({
    queryKey: ["orders"],
    queryFn: () => fetch("/api/orders").then((r) => r.json()),
  });
  const orders = data ?? [];
  return (
    <section>
      <h1>Dashboard</h1>
      <Link href="/dashboard/settings">Settings</Link>
      <ul>
        {orders.map((o: { id: string; name: string }) => (
          <li key={o.id}>{o.name}</li>
        ))}
      </ul>
    </section>
  );
}
