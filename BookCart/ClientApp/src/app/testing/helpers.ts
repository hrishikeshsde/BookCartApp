import { Observable } from "rxjs";
import { SnackbarService } from "../services/snackbar.service";

/** Subscribes and gathers everything the observable emits (effects here complete synchronously with the test's HTTP). */
export function collect<T>(source: Observable<T>): T[] {
  const emitted: T[] = [];
  source.subscribe((value) => emitted.push(value));
  return emitted;
}

/** Stands in for the snackbar and remembers what it was asked to show. */
export class SnackbarStub implements Pick<SnackbarService, "showSnackBar"> {
  readonly messages: string[] = [];
  showSnackBar(message: string) {
    this.messages.push(message);
  }
}
