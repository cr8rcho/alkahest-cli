import { Link } from "@remix-run/react";

// Pathless layout segment `_auth` is dropped → route is "/login".
export default function Login() {
  return (
    <main>
      <h1>Login</h1>
      <form>
        <input name="user" placeholder="Username" />
        <button>Sign in</button>
      </form>
      <Link to="/">Home</Link>
    </main>
  );
}
