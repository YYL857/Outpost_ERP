import { describe, expect, it } from "vitest";
import { isPlausiblePrice } from "./category-fitness.js";

describe("isPlausiblePrice", () => {
  it("rejects capacity / model / year masquerading as SAR", () => {
    expect(
      isPlausiblePrice(20000, "Goui 20000 mAh Kigo Power Bank"),
    ).toBe(false);
    expect(isPlausiblePrice(7000, "Faster XB7000 Soundbar")).toBe(false);
    expect(isPlausiblePrice(2025, "Apple iPad 2025 A16")).toBe(false);
    expect(isPlausiblePrice(3416, "Canon G3416 Printer")).toBe(false);
  });

  it("accepts normal ticket prices", () => {
    expect(isPlausiblePrice(89, "Goui 20000 mAh Power Bank")).toBe(true);
    expect(isPlausiblePrice(399, "Faster XB7000 Soundbar")).toBe(true);
    expect(isPlausiblePrice(249.5, "Wireless earbuds")).toBe(true);
  });
});
