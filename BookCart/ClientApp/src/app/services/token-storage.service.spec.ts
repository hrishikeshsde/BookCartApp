import { TestBed } from "@angular/core/testing";
import { anHourAgo, aToken, inOneHour } from "../testing/fixtures";
import { decodeJwtPayload, TokenStorage } from "./token-storage.service";

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";

describe("TokenStorage", () => {
  let storage: TokenStorage;

  beforeEach(() => {
    localStorage.removeItem("authToken");
    storage = TestBed.inject(TokenStorage);
  });
  afterEach(() => localStorage.removeItem("authToken"));

  it("returns a stored token that has not expired", () => {
    const token = aToken({ userId: "7", exp: inOneHour() });
    storage.set(token);
    expect(storage.get()).toBe(token);
  });

  it("accepts a token without an expiry claim", () => {
    const token = aToken({ userId: "7" });
    storage.set(token);
    expect(storage.get()).toBe(token);
  });

  it("treats an expired token as no token and removes it", () => {
    storage.set(aToken({ userId: "7", exp: anHourAgo() }));
    expect(storage.get()).toBeNull();
    expect(localStorage.getItem("authToken")).toBeNull();
  });

  it("treats a malformed token as no token and removes it", () => {
    storage.set("not-a-jwt");
    expect(storage.get()).toBeNull();
    expect(localStorage.getItem("authToken")).toBeNull();
  });

  it("describes the signed-in user from the token (role claim, user id, name)", () => {
    storage.set(aToken({ userId: "7", name: "reader", [ROLE_CLAIM]: "Admin", exp: inOneHour() }));
    const user = storage.user();
    expect(user?.userId).toBe(7);
    expect(user?.username).toBe("reader");
    expect(user?.userTypeName).toBe("Admin");
  });

  it("still reads the role from an older token that carried it in 'role'", () => {
    storage.set(aToken({ userId: "7", name: "reader", role: "User", exp: inOneHour() }));
    expect(storage.user()?.userTypeName).toBe("User");
  });

  it("has no user when there is no token", () => {
    expect(storage.user()).toBeNull();
  });

  it("clears the token", () => {
    storage.set(aToken({ userId: "7" }));
    storage.clear();
    expect(storage.get()).toBeNull();
  });
});

describe("decodeJwtPayload", () => {
  it("reads base64url (the - and _ characters) and non-ASCII text", () => {
    const payload = { name: "~~~???>>> Ünï", userId: "1" };
    const token = aToken(payload);
    expect(token.split(".")[1]).toMatch(/[-_]/);
    expect(decodeJwtPayload(token)).toEqual(payload);
  });

  it("returns null for garbage", () => {
    expect(decodeJwtPayload("")).toBeNull();
    expect(decodeJwtPayload("a.b.c")).toBeNull();
    expect(decodeJwtPayload("only-one-part")).toBeNull();
  });
});
