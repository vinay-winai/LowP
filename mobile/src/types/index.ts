export type PlatformId = 'amazon_tez' | 'instamart' | 'zepto' | 'blinkit';

export interface LocationProfile {
  id: string;
  name: string;
  pincode: string;
  lat: number;
  lng: number;
  address: string;
  isDefault?: boolean;
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
  _score?: number;
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
  isLowestPrice: boolean;
  responseTimeMs?: number;
  _score?: number;
}

export interface StoreAccountStatus {
  platformId: PlatformId;
  name: string;
  color: string;
  isConnected: boolean;
  accountName?: string;
  loginUrl: string;
}
