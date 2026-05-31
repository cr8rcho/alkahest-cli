import { createRouter, createWebHistory } from "vue-router";
import Home from "./views/Home.vue";
import About from "./views/About.vue";

const routes = [
  { path: "/", component: Home },
  { path: "/about", component: About },
  {
    path: "/dashboard",
    component: () => import("./views/Dashboard.vue"),
    children: [{ path: "settings", component: () => import("./views/Settings.vue") }],
  },
];

export default createRouter({ history: createWebHistory(), routes });
