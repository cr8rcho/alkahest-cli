import { Routes } from "@angular/router";
import { HomeComponent } from "./home/home.component";
import { AboutComponent } from "./about/about.component";

export const routes: Routes = [
  { path: "", component: HomeComponent },
  { path: "about", component: AboutComponent },
  {
    path: "dashboard",
    loadComponent: () => import("./dashboard/dashboard.component").then((m) => m.DashboardComponent),
    children: [
      {
        path: "settings",
        loadComponent: () => import("./settings/settings.component").then((m) => m.SettingsComponent),
      },
    ],
  },
];
