"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");

  async function onSubmit() {
    await fetch("/api/login", { method: "POST" });
    router.push("/dashboard");
  }

  return (
    <form onSubmit={onSubmit}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
      <button type="submit">Sign in</button>
    </form>
  );
}
