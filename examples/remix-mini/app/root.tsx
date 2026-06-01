import { Outlet } from "@remix-run/react";

// Root layout — not a route screen; routeFromFlat() returns null for "root".
export default function Root() {
  return <Outlet />;
}
