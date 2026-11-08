export type BrightDataOrganicHit = {
  title: string;
  url: string;
  snippet: string;
};

export type BrightDataSerpResult = {
  ok: boolean;
  httpStatus: number;
  bodyLength: number;
  elapsedMs: number;
  organics: BrightDataOrganicHit[];
  brdError?: string;
  brdErrorCode?: string;
  brdStatusCode?: string;
  emptyBody: boolean;
};

export type BrightDataPageResult = {
  ok: boolean;
  httpStatus: number;
  /** Target-site status when Bright Data reports it (x-brd-status-code). */
  targetStatusCode?: number;
  bodyLength: number;
  elapsedMs: number;
  html: string;
  brdError?: string;
  brdErrorCode?: string;
  emptyBody: boolean;
};
