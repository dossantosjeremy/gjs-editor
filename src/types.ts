export type SitePage = {
  key: string;        // url-safe unique key within the site, e.g. "home", "about"
  label: string;      // display name, e.g. "Home", "About"
  sourceUrl?: string; // optional URL to capture HTML from (must be same-origin or CORS-open)
};

export type Site = {
  id: string;
  name: string;
  description?: string;
  pages: SitePage[];
  createdAt: number;
  updatedAt: number;
};

export type Snapshot = {
  ts: number;
  label: string;
  html: string;
  css: string;
};
