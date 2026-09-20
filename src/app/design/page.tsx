import type { Metadata } from "next";
import { DesignGallery } from "@/components/design/gallery";
export const metadata: Metadata = { title: "Design system" };
export default function DesignPage() { return <DesignGallery />; }
