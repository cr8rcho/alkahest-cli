import { Link, useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();
  return (
    <main>
      <h1>Home</h1>
      <Link to="/about">About</Link>
      <button onClick={() => navigate("/dashboard")}>Go to dashboard</button>
    </main>
  );
}
