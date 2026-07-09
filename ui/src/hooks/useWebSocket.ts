import { useEffect, useState } from 'react';

export function useWebSocket(url: string) {
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    const socket = new WebSocket(url);

    socket.onopen = () => {
      console.log('WebSocket connected');
      setWs(socket);
    };

    socket.onclose = () => {
      console.log('WebSocket disconnected');
      setWs(null);
      // Reconnect after 3 seconds
      setTimeout(() => {
        console.log('Reconnecting...');
      }, 3000);
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      socket.close();
    };
  }, [url]);

  return ws;
}
