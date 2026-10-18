import { describe, expect, test } from "bun:test";
import { num } from "../src/lib/tables";

describe("num", () => {
  test("reads Danish number strings", () => {
    expect(num("101,02")).toBe(101.02);
    expect(num("4,54 %")).toBe(4.54);
    expect(num("3,36%")).toBe(3.36);
    expect(num("2,9256 %")).toBe(2.9256);
    expect(num("100")).toBe(100);
    expect(num("1.234,5")).toBe(1234.5);
  });

  test("keeps a lone dot as a decimal point", () => {
    expect(num("100.15")).toBe(100.15);
  });

  test("empty or unreadable is null", () => {
    expect(num("")).toBeNull();
    expect(num(" ")).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num(null)).toBeNull();
    expect(num("n/a")).toBeNull();
  });
});
