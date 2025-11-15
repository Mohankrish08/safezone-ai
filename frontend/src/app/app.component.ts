import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { InterfaceComponent } from "./interface/interface.component";

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, InterfaceComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'safezone-ui';
}
