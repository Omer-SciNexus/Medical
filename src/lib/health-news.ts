export const healthNewsReviewedAt = "2026-10-25";

// Curated editorial links, not an automatically refreshed feed. Check the original
// publication date and source before replacing an entry; never imply endorsement.
export const healthNews = [
  {
    id: "blood-donation", category: "Community health", source: "WHO", date: "2026-10-23",
    title: "Encouraging the next generation of blood donors",
    summary: "WHO and ENHYPEN highlight a collaboration encouraging young people to learn about voluntary blood donation and take part in their communities.",
    href: "https://www.who.int/news/item/23-10-2026-who-and-enhypen-join-efforts-to-inspire-young-blood-donors-globally",
  },
  {
    id: "diagnostics", category: "Access to care", source: "WHO", date: "2026-10-22",
    title: "A shared effort to close the diagnostic gap",
    summary: "The Global Diagnostics Coalition calls for stronger investment, coordinated national priorities, and diagnostic services that reach more communities.",
    href: "https://www.who.int/news/item/22-10-2026-global-diagnostics-coalition-calls-for-collective-action-to-close-the-diagnostic-gap",
  },
  {
    id: "neuroscience", category: "Research & innovation", source: "FDA", date: "2026-10-22",
    title: "A new initiative for neuroscience research",
    summary: "The FDA launches a program to support development of products for brain and nervous system conditions, with an initial focus on Alzheimer’s prevention research.",
    href: "https://www.fda.gov/news-events/press-announcements/fda-launches-new-program-advance-neuroscience-medical-product-development",
  },
] as const;
