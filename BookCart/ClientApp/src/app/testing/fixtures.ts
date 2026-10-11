import { Book } from "../models/book";
import { ShoppingCart } from "../models/shoppingcart";
import { User } from "../models/user";

export function aBook(id = 1, overrides: Partial<Book> = {}): Book {
  return {
    bookId: id,
    title: `Book ${id}`,
    author: "An Author",
    category: "Fiction",
    price: id * 100,
    coverFileName: `cover${id}.png`,
    ...overrides,
  };
}

export function aCartItem(id = 1, quantity = 1): ShoppingCart {
  return { book: aBook(id), quantity };
}

export function aUser(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    userId: 7,
    username: "reader",
    userTypeName: "User",
    ...overrides,
  });
}

/** A JWT with the given payload (header and signature are placeholders; the app only reads the payload). */
export function aToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

export const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;
export const anHourAgo = () => Math.floor(Date.now() / 1000) - 3600;
