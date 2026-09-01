export type PlatformId = 'amazon_tez' | 'instamart' | 'zepto' | 'blinkit' | 'amazon_main' | 'flipkart';

export interface StoreCollection {
  id: string;
  name: string;
  emoji?: string;
  storeIds: PlatformId[];
  isCustom?: boolean;
}


export interface ProductItem {
  id: string;
  title: string;
  brand: string;
  quantity: string;
  mrp: number;
  price: number;
  image: string;
  productUrl?: string;
  globalUrl?: string;
  searchUrl?: string;
  platformId?: PlatformId;
  _score?: number;
  arrivedSeq?: number;
}

export interface PriceBreakdown {
  basePrice: number;
  finalPayable: number;
  savings: number;
  discountPercent: number;
}

export interface StoreResult {
  platformId: PlatformId;
  platformName: string;
  logoColor: string;
  isAvailable: boolean;
  statusMessage: string;
  item: ProductItem | null;
  candidates?: ProductItem[];
  selectedIndex?: number;
  priceBreakdown: PriceBreakdown | null;
  productUrl: string;
  globalUrl?: string;
  searchUrl?: string;
  isLowestPrice: boolean;
  responseTimeMs?: number;
  _score?: number;
  arrivedSeq?: number;
}

export interface StoreAccountStatus {
  platformId: PlatformId;
  name: string;
  color: string;
  isConnected: boolean;
  accountName?: string;
  loginUrl: string;
}

export interface MatrixStoreCell {
  platformId: PlatformId;
  platformName: string;
  isAvailable: boolean;
  item: ProductItem | null;
  price: number;
  mrp: number;
  productUrl: string;
  isCheapestInRow: boolean;
}

export interface StrategyMatrixRow {
  id: string;
  query: string;
  addedAt: number;
  stores: Record<PlatformId, MatrixStoreCell>;
  cheapestPrice: number;
  cheapestStoreId: PlatformId | null;
}
