"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the screen when the clinic changes, over a socket that carries no content: a message
 * means "something changed", and the refresh is what fetches an authorized snapshot. The poll
 * stays as the floor, so a browser that cannot hold a socket open is merely slower, not stale.
 */
export function useLiveRefresh(channel: "clinic:board" | "clinic:queue", fallbackSeconds = 30) {
  const router = useRouter();
  const [live, setLive] = React.useState(false);

  React.useEffect(() => {
    const endpoint = process.env.NEXT_PUBLIC_REALTIME_URL;
    const poll = setInterval(() => router.refresh(), fallbackSeconds * 1_000);
    if (!endpoint) return () => clearInterval(poll);

    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;
      socket = new WebSocket(endpoint);
      socket.addEventListener("open", () => { attempt = 0; socket?.send(JSON.stringify({ type: "subscribe", channel })); });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as { type?: string };
        if (message.type === "subscribed") setLive(true);
        // No cursor and no payload: the refresh is what reads the current, authorized state.
        if (message.type === "changed") router.refresh();
      });
      socket.addEventListener("close", () => {
        setLive(false);
        if (closed) return;
        attempt += 1;
        retry = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5)));
      });
      socket.addEventListener("error", () => socket?.close());
    };
    connect();
    return () => {
      closed = true;
      clearInterval(poll);
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [channel, fallbackSeconds, router]);

  return { live, refresh: () => router.refresh() };
}
