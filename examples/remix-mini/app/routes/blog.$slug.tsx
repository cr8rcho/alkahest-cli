import { Link } from "@remix-run/react";

export default function Post() {
  return (
    <main>
      <h1>Post</h1>
      <Link to="/blog">Back to blog</Link>
    </main>
  );
}
