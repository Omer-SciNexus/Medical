import { ArrowUpRight, Brain, HeartPulse, ScanLine } from "lucide-react";
import { healthNews, healthNewsReviewedAt } from "@/lib/health-news";

const icons = { "blood-donation": HeartPulse, diagnostics: ScanLine, neuroscience: Brain };
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export function HealthNews() {
  return <section className="public-container editorial-section" id="news" aria-labelledby="news-heading">
    <div className="marketing-section-heading"><div><span className="public-eyebrow">THE HEALTH BRIEF</span><h2 id="news-heading">A wider view of care.</h2></div><p>Recent medical and public-health updates.<br />Selected from original, authoritative sources.</p></div>
    <div className="news-grid">{healthNews.map((story) => {
      const Icon = icons[story.id];
      return <article className={`news-card news-${story.id}`} key={story.id}>
        <div className="news-art" aria-hidden="true"><Icon /><span>{story.source}</span></div>
        <div className="news-body"><div className="news-meta"><span>{story.category}</span><time dateTime={story.date}>{dateLabel(story.date)}</time></div>
          <h3><a href={story.href} target="_blank" rel="noopener noreferrer">{story.title}<span className="sr-only"> — read on {story.source}, opens in a new tab</span></a></h3>
          <p>{story.summary}</p><span className="news-source">Read on {story.source} <ArrowUpRight aria-hidden="true" /></span>
        </div>
      </article>;
    })}</div>
    <p className="editorial-note">Selected on <time dateTime={healthNewsReviewedAt}>{dateLabel(healthNewsReviewedAt)}</time>. These links are curated, not a live news feed.</p>
  </section>;
}
