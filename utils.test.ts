import { describe, it, expect } from "bun:test";
import { slotHashing, isNumber } from "./utils";

describe("slotHashing", () => {
  it("maps a time to its 15-minute slot index", () => {
    expect(slotHashing("00:00")).toBe(0);
    expect(slotHashing("00:15")).toBe(1);
    expect(slotHashing("09:00")).toBe(36);
    expect(slotHashing("12:00")).toBe(48);
    expect(slotHashing("23:45")).toBe(95);
  });

  it("maps 24:00 to 96, the exclusive end of the day", () => {
    expect(slotHashing("24:00")).toBe(96);
  });

  it("floors unaligned minutes down to the slot they fall in", () => {
    expect(slotHashing("09:07")).toBe(36);
    expect(slotHashing("10:14")).toBe(40);
    expect(slotHashing("10:15")).toBe(41);
    expect(slotHashing("07:59")).toBe(31);
  });

  it("accepts hours without zero padding", () => {
    expect(slotHashing("9:30")).toBe(38);
  });

  it("returns NaN for malformed input", () => {
    expect(slotHashing("")).toBeNaN();
    expect(slotHashing("abc")).toBeNaN();
    expect(slotHashing("09")).toBeNaN();
    expect(slotHashing("09:aa")).toBeNaN();
  });
});