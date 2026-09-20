import Link from "next/link";
import { MeridianMark } from "@/components/design/graphics";

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return <Link href="/" className={`public-brand${inverse ? " public-brand-inverse" : ""}`} aria-label="Meridian home"><MeridianMark /><span>meridian<span className="brand-period">.</span></span></Link>;
}
