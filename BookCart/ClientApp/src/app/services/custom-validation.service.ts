import { inject, Injectable } from "@angular/core";
import {
  AbstractControl,
  AsyncValidatorFn,
  ValidationErrors,
  ValidatorFn,
} from "@angular/forms";
import { catchError, map, Observable, of, switchMap, timer } from "rxjs";
import { UserService } from "./user.service";

@Injectable({
  providedIn: "root",
})
export class CustomValidationService {
  private readonly userService = inject(UserService);

  patternValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) {
        return null;
      }
      const regex = new RegExp("^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9]).{8,}$");
      const valid = regex.test(control.value);
      return valid ? null : { passwordValidation: true };
    };
  }

  matchPassword(password: string, confirmPassword: string) {
    return (formGroup: AbstractControl): ValidationErrors | null => {
      const passwordControl = formGroup.get(password);
      const confirmPasswordControl = formGroup.get(confirmPassword);

      if (!passwordControl || !confirmPasswordControl) {
        return null;
      }

      if (
        confirmPasswordControl.errors &&
        !confirmPasswordControl.errors["passwordMismatch"]
      ) {
        return null;
      }

      if (passwordControl.value !== confirmPasswordControl.value) {
        confirmPasswordControl.setErrors({ passwordMismatch: true });
        return { passwordMismatch: true };
      } else {
        confirmPasswordControl.setErrors(null);
        return null;
      }
    };
  }

  /**
   * Asks the server whether the name is free. Angular unsubscribes from the previous run when the value changes, so
   * the timer is the debounce: only a name that stays put for half a second is sent.
   */
  userNameValidator(): AsyncValidatorFn {
    return (control: AbstractControl): Observable<ValidationErrors | null> => {
      if (!control.value) {
        return of(null);
      }
      return timer(500).pipe(
        switchMap(() => this.userService.validateUserName(control.value)),
        map((available) => (available ? null : { userNameNotAvailable: true })),
        // A failed lookup (for example the rate limit) must not block the form: registering rejects a taken name anyway.
        catchError(() => of(null))
      );
    };
  }
}
