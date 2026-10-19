// Client WebSocket Manager for SurakshaVahan Real-Time Streams

type MessageHandler = (data: any) => void;

class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private subscribedTrips: Set<string> = new Set();
  private reconnectTimer: any = null;
  private isConnecting: boolean = false;

  connect(token?: string) {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isConnecting = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    const wsUrl = `${protocol}//${host}/ws${query}`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.isConnecting = false;
        console.log('[WebSocket Client] Connected to SurakshaVahan live stream.');
        // Re-subscribe to any active trips
        this.subscribedTrips.forEach((tripId) => {
          this.send('SUBSCRIBE_TRIP', { tripId });
        });
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handlers.forEach((h) => h(data));
        } catch (e) {
          // parse error
        }
      };

      this.socket.onclose = () => {
        this.isConnecting = false;
        this.socket = null;
        // Reconnect after 3 seconds
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          this.connect(token);
        }, 3000);
      };

      this.socket.onerror = () => {
        this.socket?.close();
      };
    } catch (err) {
      this.isConnecting = false;
    }
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.subscribedTrips.clear();
  }

  subscribeTrip(tripId: string) {
    this.subscribedTrips.add(tripId);
    this.send('SUBSCRIBE_TRIP', { tripId });
  }

  unsubscribeTrip(tripId: string) {
    this.subscribedTrips.delete(tripId);
    this.send('UNSUBSCRIBE_TRIP', { tripId });
  }

  onMessage(handler: MessageHandler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private send(type: string, payload: any) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, payload }));
    }
  }
}

export const realtime = new RealtimeClient();
