import { TestBed } from "@angular/core/testing";
import { Route } from "@angular/router";
import { of } from "rxjs";
import { SelectivePreloadingStrategy } from "./selective-preload";

describe("SelectivePreloadingStrategy", () => {
  const strategy = () => TestBed.inject(SelectivePreloadingStrategy);

  it("loads a route in the background", () => {
    const load = vi.fn(() => of("loaded"));
    const emitted: unknown[] = [];
    strategy().preload({ path: "login" } as Route, load).subscribe((value) => emitted.push(value));
    expect(load).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual(["loaded"]);
  });

  it("leaves alone a route marked data: { preload: false } (the admin pages)", () => {
    const load = vi.fn(() => of("loaded"));
    strategy().preload({ path: "admin/books", data: { preload: false } } as Route, load).subscribe();
    expect(load).not.toHaveBeenCalled();
  });

  it("a route whose data says nothing about preloading is loaded", () => {
    const load = vi.fn(() => of("loaded"));
    strategy().preload({ path: "x", data: { other: 1 } } as Route, load).subscribe();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
