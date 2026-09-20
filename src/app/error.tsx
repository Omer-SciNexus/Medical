"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="standalone"><span className="eyebrow">Meridian</span><h1>The page couldn’t be loaded.</h1><p>Your connection may have been interrupted. Try loading this page again.</p><button className="button button-primary" onClick={reset}>Try again</button></main>; }
