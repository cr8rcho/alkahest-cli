"use client";
import { useState } from "react";

export default function Settings() {
  const [name, setName] = useState("");
  async function save() {
    await fetch("/api/settings", { method: "PUT" });
  }
  return (
    <form onSubmit={save}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <textarea placeholder="Bio" />
      <button>Save</button>
    </form>
  );
}
