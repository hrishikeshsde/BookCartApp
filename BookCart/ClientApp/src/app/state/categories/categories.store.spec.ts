import { provideHttpClient, withXhr } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { CategoriesStore } from "./categories.store";

const url = "/api/book/GetCategoriesList";
const fiction = { categoryId: 1, categoryName: "Fiction" };

describe("CategoriesStore", () => {
  let store: InstanceType<typeof CategoriesStore>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(withXhr()), provideHttpClientTesting()] });
    store = TestBed.inject(CategoriesStore);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it("starts empty and not loading", () => {
    expect(store.categories()).toEqual([]);
    expect(store.loading()).toBe(false);
    expect(store.loaded()).toBe(false);
  });

  it("loads the categories, showing that it is loading meanwhile", () => {
    store.load();
    expect(store.loading()).toBe(true);

    http.expectOne(url).flush([fiction]);

    expect(store.categories()).toEqual([fiction]);
    expect(store.loaded()).toBe(true);
    expect(store.loading()).toBe(false);
  });

  it("asks only once: a second load while loading or once loaded sends nothing", () => {
    store.load();
    store.load();
    http.expectOne(url).flush([fiction]);

    store.load();
    http.expectNone(url);
  });

  it("keeps the error text when the call fails, and tries again on the next load", () => {
    store.load();
    http.expectOne(url).flush({ detail: "Database is down" }, { status: 500, statusText: "Server Error" });
    expect(store.error()).toBe("Database is down");
    expect(store.loaded()).toBe(false);

    store.load();
    http.expectOne(url).flush([fiction]);
    expect(store.error()).toBeNull();
    expect(store.categories()).toEqual([fiction]);
  });
});
