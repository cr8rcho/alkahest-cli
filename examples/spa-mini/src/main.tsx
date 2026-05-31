import { lazy } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Home from "./pages/Home";
import About from "./pages/About";
import Dashboard from "./pages/Dashboard";

// Lazy route component → resolved through the `lazy(() => import(...))` form.
const Settings = lazy(() => import("./pages/Settings"));

const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/about", element: <About /> },
  {
    path: "/dashboard",
    element: <Dashboard />,
    children: [{ path: "settings", element: <Settings /> }],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
