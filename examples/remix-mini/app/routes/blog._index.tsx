import { Link } from "@remix-run/react";

export default function Blog() {
  const posts = ["hello-world", "second-post"];
  return (
    <main>
      <h1>Blog</h1>
      <button onClick={() => fetch("/api/posts")}>Refresh</button>
      <ul>
        {posts.map((slug) => (
          <li key={slug}>
            <Link to={`/blog/${slug}`}>{slug}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
