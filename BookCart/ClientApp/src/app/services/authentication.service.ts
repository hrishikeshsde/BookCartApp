import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { LoginResponse, UserLogin } from "../models/userLogin";

@Injectable({
  providedIn: "root",
})
export class AuthenticationService {
  private readonly http = inject(HttpClient);

  login(user: UserLogin) {
    return this.http.post<LoginResponse>("/api/login", user);
  }
}
