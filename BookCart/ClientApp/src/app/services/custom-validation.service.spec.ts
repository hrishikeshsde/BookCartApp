import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { fakeAsync, TestBed, tick } from "@angular/core/testing";
import { FormControl, FormGroup } from "@angular/forms";
import { Observable } from "rxjs";
import { CustomValidationService } from "./custom-validation.service";

describe("CustomValidationService", () => {
  let service: CustomValidationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CustomValidationService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  describe("patternValidator", () => {
    const validate = (value: string) => service.patternValidator()(new FormControl(value));

    it("wants upper case, lower case, a digit and 8 characters", () => {
      expect(validate("Abcdefg1")).toBeNull();
      expect(validate("abcdefg1")).toEqual({ passwordValidation: true });
      expect(validate("ABCDEFG1")).toEqual({ passwordValidation: true });
      expect(validate("Abcdefgh")).toEqual({ passwordValidation: true });
      expect(validate("Abc1")).toEqual({ passwordValidation: true });
    });

    it("leaves an empty value to the required validator", () => {
      expect(validate("")).toBeNull();
    });
  });

  describe("matchPassword", () => {
    it("flags a confirmation that differs, and clears it when it matches", () => {
      const form = new FormGroup({ password: new FormControl("Abcdefg1"), confirm: new FormControl("other") });
      const check = service.matchPassword("password", "confirm");

      expect(check(form)).toEqual({ passwordMismatch: true });
      expect(form.get("confirm")?.errors).toEqual({ passwordMismatch: true });

      form.get("confirm")?.setValue("Abcdefg1");
      expect(check(form)).toBeNull();
      expect(form.get("confirm")?.errors).toBeNull();
    });
  });

  describe("userNameValidator", () => {
    const validate = (value: string) =>
      service.userNameValidator()(new FormControl(value)) as Observable<unknown>;

    function run(value: string, answer: boolean | "error") {
      let result: unknown = "pending";
      validate(value).subscribe((r) => (result = r));
      tick(500);
      const request = http.expectOne("/api/user/validateUserName/" + encodeURIComponent(value));
      if (answer === "error") {
        request.flush("", { status: 429, statusText: "Too Many Requests" });
      } else {
        request.flush(answer);
      }
      return result;
    }

    it("accepts a free name", fakeAsync(() => {
      expect(run("newreader", true)).toBeNull();
    }));

    it("flags a taken name", fakeAsync(() => {
      expect(run("taken", false)).toEqual({ userNameNotAvailable: true });
    }));

    it("encodes the name in the URL", fakeAsync(() => {
      expect(run("a b/c?", true)).toBeNull();
    }));

    it("does not block the form when the lookup fails (the server rejects a taken name anyway)", fakeAsync(() => {
      expect(run("whoever", "error")).toBeNull();
    }));

    it("waits half a second before asking, and sends nothing if the value changed meanwhile", fakeAsync(() => {
      let result: unknown = "pending";
      const subscription = validate("abc").subscribe((r) => (result = r));
      tick(499);
      http.expectNone("/api/user/validateUserName/abc");
      subscription.unsubscribe(); // what Angular does when the control's value changes
      tick(1000);
      http.expectNone("/api/user/validateUserName/abc");
      expect(result).toBe("pending");
    }));

    it("sends nothing for an empty value", fakeAsync(() => {
      let result: unknown = "pending";
      validate("").subscribe((r) => (result = r));
      tick(1000);
      http.expectNone(() => true);
      expect(result).toBeNull();
    }));
  });
});
