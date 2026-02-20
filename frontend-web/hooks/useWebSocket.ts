"use client";

import { useEffect, useRef, useCallback } from "react";
import Cookies from "js-cookie";

function getWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost/ws";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export function useWebSocket(onMessage: (data: unknown) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const token = Cookies.get("access_token");
    if (!token) return;

    const url = `${getWsUrl()}?token=${token}`;
    const ws = new WebSocket(url);
    ws.onopen = () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
    };
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onMessage(data);
      } catch {}
    };
    ws.onclose = () => {
      reconnectTimeout.current = setTimeout(connect, 3000);
    };
    ws.onerror = () => ws.close();
    wsRef.current = ws;
  }, [onMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { send };
}
