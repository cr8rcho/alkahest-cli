import { Routes, Route } from "react-router-dom";
import Home from "./screens/Home";
import Profile from "./screens/Profile";
import Edit from "./screens/Edit";

// JSX route form, incl. nested + index route.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="profile">
        <Route index element={<Profile />} />
        <Route path="edit" element={<Edit />} />
      </Route>
    </Routes>
  );
}
