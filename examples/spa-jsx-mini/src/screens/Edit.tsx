import { Navigate } from "react-router-dom";

export default function Edit() {
  const saved = false;
  if (saved) return <Navigate to="/profile" />;
  return (
    <main>
      <h1>Edit profile</h1>
      <button>Save</button>
    </main>
  );
}
