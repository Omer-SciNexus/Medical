import { describe, expect, it } from "vitest";
import { greetingName } from "../../src/lib/format";

describe("dashboard greeting", () => {
  it("greets by first name, or by title and surname, never by a bare title", () => {
    expect(greetingName("Asel Yilmaz")).toBe("Asel");
    expect(greetingName("  Dr Asel Yilmaz ")).toBe("Dr Yilmaz");
    expect(greetingName("Prof. Ana Maria Costa")).toBe("Prof. Costa");
    expect(greetingName("Drew Barker")).toBe("Drew");
    expect(greetingName("Dr")).toBe("Dr");
  });
});
