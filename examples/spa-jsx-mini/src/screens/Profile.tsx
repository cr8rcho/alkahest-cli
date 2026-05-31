import { Link } from "react-router-dom";

export default function Profile() {
  return (
    <main>
      <h1>Profile</h1>
      <Link to="/profile/edit">Edit</Link>
    </main>
  );
}
