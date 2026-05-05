/**
 * @file useToolboxAPI.ts
 * @description React hook for using PPTB API in components.
 * Provides access to connection state and theme information.
 */

import { useState, useEffect, useCallback } from 'react';
import { isInPPTB, onToolboxEvent, type IConnection } from '../api/toolboxAPI';

interface ConnectionSubscriber {
  (connection: IConnection | null): void;
}

class ConnectionStateStore {
  private connection: IConnection | null = null;
  private subscribers: Set<ConnectionSubscriber> = new Set();
  private initialized = false;

  async initialize(): Promise<IConnection | null> {
    if (this.initialized) {
      return this.connection;
    }

    this.connection = await (isInPPTB() ? window.toolboxAPI.connections.getActiveConnection() : null);
    this.initialized = true;

    onToolboxEvent((_event, payload) => {
      if (payload.event === 'connection:updated' || payload.event === 'connection:changed') {
        void this.refreshConnection();
      }
    });

    return this.connection;
  }

  async refreshConnection(): Promise<void> {
    const newConnection = await (isInPPTB() ? window.toolboxAPI.connections.getActiveConnection() : null);
    if (this.connection?.id !== newConnection?.id) {
      this.connection = newConnection;
      this.notifySubscribers();
    }
  }

  getConnection(): IConnection | null {
    return this.connection;
  }

  subscribe(callback: ConnectionSubscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private notifySubscribers(): void {
    this.subscribers.forEach((subscriber) => {
      subscriber(this.connection);
    });
  }
}

const connectionStore = new ConnectionStateStore();

interface ToolboxAPIState {
  connection: IConnection | null;
  isLoading: boolean;
  isInPPTB: boolean;
  theme: 'light' | 'dark' | null;
  initializeConnection: () => Promise<IConnection | null>;
}

interface UseToolboxAPIOptions {
  autoInitConnection?: boolean;
}

/**
 * Hook to access PPTB APIs and connection state
 * 
 * Usage:
 * ```tsx
 * const { connection, isLoading, isInPPTB } = useToolboxAPI();
 * 
 * if (isLoading) return <div>Loading...</div>;
 * if (!isInPPTB) return <div>Not running in PPTB</div>;
 * if (!connection) return <div>No connection</div>;
 * 
 * return <div>Connected to {connection.name}</div>;
 * ```
 */
export function useToolboxAPI(options: UseToolboxAPIOptions = {}): ToolboxAPIState {
  const { autoInitConnection = true } = options;
  const [connection, setConnection] = useState<IConnection | null>(null);
  const [isLoading, setIsLoading] = useState(autoInitConnection);
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  const initializeConnection = useCallback(async (): Promise<IConnection | null> => {
    if (!isInPPTB()) {
      setConnection(null);
      setIsLoading(false);
      return null;
    }

    setIsLoading(true);
    try {
      const conn = await connectionStore.initialize();
      setConnection(conn);
      return conn;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    if (autoInitConnection) {
      timer = window.setTimeout(() => {
        void initializeConnection();
      }, 0);
    }

    // Subscribe to connection changes
    const unsubscribe = connectionStore.subscribe((conn) => {
      setConnection(conn);
    });

    // Subscribe to theme changes
    onToolboxEvent((_event, payload) => {
      if (payload.event === 'theme:updated' || payload.event === 'theme:changed') {
        const data = payload.data as { theme?: 'light' | 'dark' } | undefined;
        setTheme(data?.theme ?? null);
      }
    });

    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
      unsubscribe?.();
    };
  }, [autoInitConnection, initializeConnection]);

  return {
    connection,
    isLoading,
    isInPPTB: isInPPTB(),
    theme,
    initializeConnection,
  };
}

/**
 * Hook to check if running in PPTB environment
 */
export function useIsInPPTB(): boolean {
  const [inPPTB] = useState<boolean>(() => isInPPTB());
  return inPPTB;
}

/**
 * Hook to access the active connection
 */
export function useConnection(): IConnection | null {
  const [connection, setConnection] = useState<IConnection | null>(() => connectionStore.getConnection());

  useEffect(() => {
    const unsubscribe = connectionStore.subscribe((conn) => {
      setConnection(conn);
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  return connection;
}
