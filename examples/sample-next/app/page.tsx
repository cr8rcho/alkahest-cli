import Link from "next/link";

export default async function Home() {
  const res = await fetch("/api/stats");
  const stats = await res.json();
  return (
    <main>
      <h1>Home</h1>
      <p>{stats.count}</p>
      <Link href="/login">Login</Link>
      <Link href="/dashboard">Go to dashboard</Link>
      <a href="https://example.com">External</a>
    </main>
  );
}
