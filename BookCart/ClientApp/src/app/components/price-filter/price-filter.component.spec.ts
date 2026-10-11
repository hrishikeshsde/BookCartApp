import { ComponentFixture, TestBed } from "@angular/core/testing";
import { PriceFilterComponent } from "./price-filter.component";

describe("PriceFilterComponent", () => {
  let fixture: ComponentFixture<PriceFilterComponent>;
  let component: PriceFilterComponent;
  const root = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [PriceFilterComponent] });
    fixture = TestBed.createComponent(PriceFilterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it("shows nothing until there is a price range to choose from", () => {
    expect(root().querySelector("mat-slider")).toBeNull();
  });

  it("shows the ends of the range in rupees", () => {
    fixture.componentRef.setInput("range", { minPrice: 100, maxPrice: 900 });
    fixture.detectChanges();

    expect(root().querySelector("mat-slider")).not.toBeNull();
    expect(root().textContent).toContain("₹100.00");
    expect(root().textContent).toContain("₹900.00");
  });

  it("reports the chosen price as a number (the slider hands over text)", () => {
    const chosen: number[] = [];
    component.priceChange.subscribe((price) => chosen.push(price));

    component.onChange({ target: { value: "450" } } as unknown as Event);

    expect(chosen).toEqual([450]);
    expect(typeof chosen[0]).toBe("number");
  });

  it("labels big values in thousands", () => {
    expect(component.formatLabel(999)).toBe("999");
    expect(component.formatLabel(1500)).toBe("2k");
  });
});
