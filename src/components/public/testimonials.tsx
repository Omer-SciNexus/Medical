import Image from "next/image";
import { Quote, Info } from "lucide-react";

// Illustrative copy for the preview, not genuine customer endorsements.
// Replace with approved quotes before adding customer names or organizations.
const testimonials = [
  {
    role: "Clinician perspective",
    topic: "More focus on the person.",
    quote: "Being able to review a patient’s context alongside the visit note helps me give the conversation my full attention. That is the kind of support I want from a clinical workspace.",
    portrait: "/images/meridian/testimonial-clinician.webp",
  },
  {
    role: "Front-desk perspective",
    topic: "A team that stays in step.",
    quote: "A good clinic day starts with knowing who has arrived and what happens next. A clear view of appointments and the waiting room helps everyone work from the same picture.",
    portrait: "/images/meridian/testimonial-front-desk.webp",
  },
  {
    role: "Patient perspective",
    topic: "Clear before. Clear after.",
    quote: "I want to know when my appointment is, how to change it, and where to find my next steps. Having those details together makes the whole experience feel simpler.",
    portrait: "/images/meridian/testimonial-patient.webp",
  },
];

export function Testimonials() {
  return (
    <section className="testimonial-section" id="testimonials" aria-labelledby="testimonials-heading">
      <div className="public-container">
        <div className="marketing-section-heading testimonial-heading">
          <div>
            <span className="public-eyebrow">PEOPLE &amp; PERSPECTIVES</span>
            <h2 id="testimonials-heading">A better day.<br /><em>From every perspective.</em></h2>
          </div>
          <p>Behind every appointment, there are people.<br />A little more clarity can make room for what matters.</p>
        </div>
        <div className="testimonial-grid">
          {testimonials.map(({ role, topic, quote, portrait }) => (
            <article className="testimonial-card" key={role}>
              <div className="testimonial-story">
                <Quote className="testimonial-quote-mark" aria-hidden="true" />
                <h3>{topic}</h3>
                <blockquote><p>&ldquo;{quote}&rdquo;</p></blockquote>
              </div>
              <footer className="testimonial-role">
                <Image className="testimonial-portrait" src={portrait} alt={`Illustrated fictional person: ${role.toLowerCase()}`} width={80} height={80} sizes="64px" />
                <div><strong>{role}</strong><span>Illustrative testimonial</span></div>
              </footer>
            </article>
          ))}
        </div>
        <div className="testimonial-disclosure">
          <Info aria-hidden="true" />
          <p><strong>A note on these perspectives.</strong> Fictional examples, not verified customer reviews. Portraits are AI-generated illustrations.</p>
        </div>
      </div>
    </section>
  );
}
