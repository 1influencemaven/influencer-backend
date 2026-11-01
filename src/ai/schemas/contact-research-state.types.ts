export type ContactResearchStateSnapshot = {
  brandName: string;
  website: string;
  domain: string;
  marketHint?: string;
  limits: {
    maxSerpQueries: number;
    maxPages: number;
  };
  serpQueriesUsed: number;
  pagesFetched: number;
  iterationsRemaining: number;
  emailsFound: string[];
  executedQueries: string[];
  fetchedUrls: string[];
  lastObservation?: string;
};
