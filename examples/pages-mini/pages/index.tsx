import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Home</h1>
      <Link href="/blog">Read the blog</Link>
      <a href="/about">About us</a>
    </main>
  );
}
