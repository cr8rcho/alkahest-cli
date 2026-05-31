export default function Post() {
  const load = () => fetch("/api/posts", { method: "GET" });
  return (
    <main>
      <h1>Post</h1>
      <button onClick={load}>Load post</button>
    </main>
  );
}
