import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { aCartItem } from "../testing/fixtures";
import { AuthenticationService } from "./authentication.service";
import { BookService } from "./book.service";
import { CartService } from "./cart.service";
import { CheckoutService } from "./checkout.service";
import { UserService } from "./user.service";
import { WishlistService } from "./wishlist.service";

// The URL, the verb and the body of every call. No call may carry a user id: the server knows who is asking.
describe("API services", () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it("CartService", () => {
    const cart = TestBed.inject(CartService);
    const items = [aCartItem(1, 2)];

    let got: unknown;
    cart.getCartItems().subscribe((r) => (got = r));
    const read = http.expectOne("/api/shoppingcart");
    expect(read.request.method).toBe("GET");
    read.flush(items);
    expect(got).toEqual(items);

    cart.addBookToCart(5).subscribe();
    const add = http.expectOne("/api/shoppingcart/items/5");
    expect(add.request.method).toBe("POST");
    add.flush(items);

    cart.reduceCartQuantity(5).subscribe();
    expect(http.expectOne("/api/shoppingcart/items/5").request.method).toBe("PATCH");

    cart.removeBookFromCart(5).subscribe();
    expect(http.expectOne("/api/shoppingcart/items/5").request.method).toBe("DELETE");

    cart.clearCart().subscribe();
    const clear = http.expectOne("/api/shoppingcart");
    expect(clear.request.method).toBe("DELETE");
  });

  it("WishlistService", () => {
    const wishlist = TestBed.inject(WishlistService);
    wishlist.getWishlistItems().subscribe();
    expect(http.expectOne("/api/wishlist").request.method).toBe("GET");
    wishlist.toggleWishlistItem(3).subscribe();
    expect(http.expectOne("/api/wishlist/items/3").request.method).toBe("POST");
    wishlist.clearWishlist().subscribe();
    expect(http.expectOne("/api/wishlist").request.method).toBe("DELETE");
  });

  it("BookService", () => {
    const books = TestBed.inject(BookService);
    books.getAllBooks().subscribe();
    expect(http.expectOne("/api/book").request.method).toBe("GET");

    const form = new FormData();
    books.addBook(form).subscribe();
    const add = http.expectOne("/api/book");
    expect(add.request.method).toBe("POST");
    expect(add.request.body).toBe(form);

    books.updateBookDetails(form).subscribe();
    expect(http.expectOne("/api/book").request.method).toBe("PUT");

    books.deleteBook(4).subscribe();
    expect(http.expectOne("/api/book/4").request.method).toBe("DELETE");

    books.getSimilarBooks(4).subscribe();
    expect(http.expectOne("/api/book/GetSimilarBooks/4").request.method).toBe("GET");

    books.getCategories().subscribe();
    expect(http.expectOne("/api/book/GetCategoriesList").request.method).toBe("GET");

    let summary = "";
    books.getBookSummary(4).subscribe((r) => (summary = r.summary));
    const request = http.expectOne("/api/book/4/summary");
    expect(request.request.method).toBe("POST");
    request.flush({ summary: "A fine book." });
    expect(summary).toBe("A fine book.");
  });

  it("CheckoutService sends nothing about the order", () => {
    TestBed.inject(CheckoutService).placeOrder().subscribe();
    const request = http.expectOne("/api/checkout");
    expect(request.request.method).toBe("POST");
    expect(request.request.body).toEqual({});
  });

  it("UserService registers and checks a name (encoded)", () => {
    const users = TestBed.inject(UserService);
    const details = { firstName: "A", lastName: "B", username: "ab", password: "Abcdefg1", gender: "Male" };
    users.registerUser(details).subscribe();
    const register = http.expectOne("/api/user/");
    expect(register.request.method).toBe("POST");
    expect(register.request.body).toEqual(details);

    users.validateUserName("a b").subscribe();
    expect(http.expectOne("/api/user/validateUserName/a%20b").request.method).toBe("GET");
  });

  it("AuthenticationService posts the credentials", () => {
    const credentials = { username: "reader", password: "Abcdefg1" };
    let token = "";
    TestBed.inject(AuthenticationService).login(credentials).subscribe((r) => (token = r.token));
    const request = http.expectOne("/api/login");
    expect(request.request.method).toBe("POST");
    expect(request.request.body).toEqual(credentials);
    request.flush({ token: "abc" });
    expect(token).toBe("abc");
  });
});
