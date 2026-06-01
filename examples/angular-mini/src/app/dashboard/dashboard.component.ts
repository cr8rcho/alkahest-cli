import { Component } from "@angular/core";
import { HttpClient } from "@angular/common/http";

@Component({
  selector: "app-dashboard",
  standalone: true,
  template: `
    <main>
      <h1>Dashboard</h1>
      <a routerLink="/dashboard/settings">Settings</a>
      <ul>
        <li *ngFor="let item of items">{{ item }}</li>
      </ul>
    </main>
  `,
})
export class DashboardComponent {
  items: string[] = [];
  constructor(private http: HttpClient) {}

  load() {
    this.http.get("/api/stats").subscribe((data: any) => (this.items = data));
  }
}
