import { ChangeDetectionStrategy, Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { NavBarComponent } from "./components/nav-bar/nav-bar.component";

// The stored session (AuthStore) and the visitor's cart (CartStore) are picked up when the nav bar first uses them.
@Component({
    selector: "app-root",
    templateUrl: "./app.component.html",
    styleUrls: ["./app.component.scss"],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NavBarComponent, RouterOutlet]
})
export class AppComponent {
  /** The address bar fragment (#main) would break under <base href="/">, so the link focuses the page itself. */
  protected skipToContent(event: Event) {
    event.preventDefault();
    document.getElementById("main")?.focus();
  }
}
