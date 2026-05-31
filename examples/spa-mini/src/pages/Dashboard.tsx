import { NavLink } from "react-router-dom";

export default function Dashboard() {
  const load = () => fetch("/api/stats");
  return (
    <main>
      <h1>Dashboard</h1>
      <NavLink to="/dashboard/settings">Settings</NavLink>
      <button onClick={load}>Refresh</button>
    </main>
  );
}
