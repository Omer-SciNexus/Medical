import { describe, expect, it } from "vitest";
import { clientAddressFromHeaders } from "../../src/modules/identity/client-address";
describe("trusted client address", () => {
  it("ignores forwarded addresses unless the proxy contract is explicitly configured", () => {
    const headers = new Headers({ "x-real-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.2" });
    expect(clientAddressFromHeaders(headers)).toBe("public-web");
    expect(clientAddressFromHeaders(headers, "x-forwarded-for")).toBe("public-web");
    expect(clientAddressFromHeaders(headers, "x-real-ip")).toBe("192.0.2.1");
  });
  it("accepts IPv6 and falls back safely for absent or ambiguous headers", () => {
    expect(clientAddressFromHeaders(new Headers({ "cf-connecting-ip": "2001:DB8::1" }), "cf-connecting-ip")).toBe("2001:db8::1");
    for (const value of ["", "unknown", "192.0.2.1,192.0.2.2"]) {
      expect(clientAddressFromHeaders(new Headers({ "x-real-ip": value }), "x-real-ip")).toBe("public-web");
    }
  });
});
