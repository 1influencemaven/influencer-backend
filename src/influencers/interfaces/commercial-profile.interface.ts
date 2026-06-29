export interface BuyerPersona {
  title: string;
  seniority?: string;
  responsibilities?: string[];
}

export interface CommercialProfile {
  idealBrands: string[];
  brandSize: string[];
  departments: string[];
  buyerPersonas: BuyerPersona[];
  futureMetadata?: Record<string, unknown>;
}

export interface GenerateInfluencerProfileJobData {
  influencerId: string;
}
