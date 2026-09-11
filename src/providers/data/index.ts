import graphqlDataProvider, {
  GraphQLClient,
  liveProvider as graphqlLiveProvider,
} from "@refinedev/nestjs-query";
import { createClient } from "graphql-ws";

import { fetchWrapper } from "./fetch-wrapper";

export const API_BASE_URL = "https://api.crm.refine.dev";
export const API_URL = `${API_BASE_URL}/graphql`;
export const WS_URL = "wss://api.crm.refine.dev/graphql";

// --- GraphQL Client (dataProvider) ---
export const client = new GraphQLClient(API_URL, {
  fetch: (url: string, options: RequestInit) => {
    try {
      return fetchWrapper(url, options);
    } catch (error) {
      return Promise.reject(error as Error);
    }
  },
});

export const dataProvider = graphqlDataProvider(client);

// --- WebSocket Client (liveProvider) ---
// Safely check for browser environment
let wsClient;
if (typeof window !== "undefined") {
  wsClient = createClient({
    url: WS_URL,
    connectionParams: () => {
      const accessToken =
        typeof window !== "undefined"
          ? sessionStorage.getItem("access_token")
          : null;

      return {
        headers: {
          Authorization: `Bearer ${accessToken ?? ""}`,
        },
      };
    },
  });
}

// Only assign liveProvider if WebSocket client is available
export const liveProvider = wsClient ? graphqlLiveProvider(wsClient) : undefined;
