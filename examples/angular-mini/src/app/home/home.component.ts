import { Component } from "@angular/core";
import { Router } from "@angular/router";

@Component({
  selector: "app-home",
  standalone: true,
  template: `
    <main>
      <h1>Home</h1>
      <a routerLink="/about">About</a>
      <button (click)="goToDashboard()">Dashboard</button>
    </main>
  `,
})
export class HomeComponent {
  constructor(private router: Router) {}

  goToDashboard() {
    this.router.navigate(["/dashboard"]);
  }
}
