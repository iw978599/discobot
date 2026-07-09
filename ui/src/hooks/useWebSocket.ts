import { useEffect, useRef, useState } from 'react';

export function useWebSocket(url: string, onMessage: (data: any) => void) {
  const [connected, setConnected] = useState(false);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let mounted = true;

    function connect() {
      const socket = new WebSocket(url);

      socket.onopen = () => {
        if (mounted) {
          console.log('WebSocket connected');
          setConnected(true);
        }
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          onMessageRef.current(message);
        } catch (e) {
          console.error('WebSocket parse error:', e);
        }
      };

      socket.onclose = () => {
        if (mounted) {
          console.log('WebSocket disconnected');
          setConnected(false);
          reconnectRef.current = setTimeout(connect, 3000);
        }
      };

      socket.onerror = () => {
      };
    }

    connect();

    return () => {
      mounted = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      setConnected(false);
    };
  }, [url]);

  return connected;
}
