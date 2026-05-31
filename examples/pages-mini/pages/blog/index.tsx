import Link from "next/link";
import { useRouter } from "next/router";

export default function Blog() {
  const router = useRouter();
  const posts = ["hello-world", "second-post"];
  return (
    <main>
      <h1>Blog</h1>
      <button onClick={() => router.push("/")}>Home</button>
      <ul>
        {posts.map((slug) => (
          <li key={slug}>
            <Link href={`/blog/${slug}`}>{slug}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
