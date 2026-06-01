import { Component } from "@angular/core";

@Component({
  selector: "app-settings",
  standalone: true,
  template: `
    <main>
      <h1>Settings</h1>
      <a routerLink="/">Back home</a>
    </main>
  `,
})
export class SettingsComponent {}
