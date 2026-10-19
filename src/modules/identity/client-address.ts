import { isIP } from "node:net";

/** Trust only a header explicitly configured for a proxy that overwrites it. */
export function clientAddressFromHeaders(headers: Pick<Headers, "get">, trustedHeader?: string) {
  if (!trustedHeader || !["x-real-ip", "cf-connecting-ip"].includes(trustedHeader.toLowerCase())) return "public-web";
  const value = headers.get(trustedHeader)?.trim();
  return value && isIP(value) ? value.toLowerCase() : "public-web";
}
