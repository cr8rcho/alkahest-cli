// API route — must be excluded from the product map (not a screen).
export default function handler(_req: unknown, res: { json: (b: unknown) => void }) {
  res.json([{ slug: "hello-world" }]);
}
