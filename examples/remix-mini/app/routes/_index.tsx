import { Link, useNavigate } from "@remix-run/react";

export default function Index() {
  const navigate = useNavigate();
  return (
    <main>
      <h1>Home</h1>
      <Link to="/about">About</Link>
      <button onClick={() => navigate("/blog")}>Blog</button>
    </main>
  );
}
