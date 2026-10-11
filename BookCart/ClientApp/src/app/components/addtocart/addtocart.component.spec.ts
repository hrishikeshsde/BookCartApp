import { ComponentFixture, TestBed } from "@angular/core/testing";
import { AddtocartComponent } from "./addtocart.component";

describe("AddtocartComponent", () => {
  let fixture: ComponentFixture<AddtocartComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AddtocartComponent] });
    fixture = TestBed.createComponent(AddtocartComponent);
    fixture.componentRef.setInput("bookId", 7);
    fixture.detectChanges();
  });

  it("says which book was asked for when the button is clicked", () => {
    const added: number[] = [];
    fixture.componentInstance.add.subscribe((id) => added.push(id));

    (fixture.nativeElement as HTMLElement).querySelector("button")!.click();
    (fixture.nativeElement as HTMLElement).querySelector("button")!.click();

    expect(added).toEqual([7, 7]);
  });

  it("follows the book it is given", () => {
    const added: number[] = [];
    fixture.componentInstance.add.subscribe((id) => added.push(id));
    fixture.componentRef.setInput("bookId", 9);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector("button")!.click();

    expect(added).toEqual([9]);
  });
});
