import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocationProfile } from '../types';

export const DEFAULT_LOCATION: LocationProfile = {
  id: 'loc_hyd_500085',
  name: 'Hyderabad (Kukatpally)',
  pincode: '500085',
  lat: 17.501725514188223,
  lng: 78.39361254731166,
  address: 'Kukatpally, Hyderabad, Telangana 500085',
  isDefault: true
};

export const DEFAULT_PROFILES: LocationProfile[] = [
  DEFAULT_LOCATION,
  {
    id: 'loc_blr_560034',
    name: 'Bengaluru (Koramangala)',
    pincode: '560034',
    lat: 12.9352,
    lng: 77.6245,
    address: 'Koramangala, Bengaluru, Karnataka 560034'
  },
  {
    id: 'loc_mum_400050',
    name: 'Mumbai (Bandra)',
    pincode: '400050',
    lat: 19.0596,
    lng: 72.8295,
    address: 'Bandra West, Mumbai, Maharashtra 400050'
  },
  {
    id: 'loc_del_110001',
    name: 'Delhi (Connaught Place)',
    pincode: '110001',
    lat: 28.6304,
    lng: 77.2177,
    address: 'Connaught Place, New Delhi, Delhi 110001'
  }
];

const STORAGE_ACTIVE_LOCATION = '@lowp_active_location';
const STORAGE_LOCATION_PROFILES = '@lowp_location_profiles';

export class LocationService {
  static async getActiveLocation(): Promise<LocationProfile> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_ACTIVE_LOCATION);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {}
    return DEFAULT_LOCATION;
  }

  static async setActiveLocation(profile: LocationProfile): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_ACTIVE_LOCATION, JSON.stringify(profile));
    } catch (e) {}
  }

  static async getProfiles(): Promise<LocationProfile[]> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_LOCATION_PROFILES);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {}
    return DEFAULT_PROFILES;
  }

  static async addProfile(profile: LocationProfile): Promise<LocationProfile[]> {
    try {
      const current = await this.getProfiles();
      const updated = [...current.filter((p) => p.id !== profile.id), profile];
      await AsyncStorage.setItem(STORAGE_LOCATION_PROFILES, JSON.stringify(updated));
      return updated;
    } catch (e) {
      return DEFAULT_PROFILES;
    }
  }

  static async deleteProfile(profileId: string): Promise<LocationProfile[]> {
    try {
      const current = await this.getProfiles();
      const updated = current.filter((p) => p.id !== profileId);
      await AsyncStorage.setItem(STORAGE_LOCATION_PROFILES, JSON.stringify(updated));
      return updated;
    } catch (e) {
      return DEFAULT_PROFILES;
    }
  }
}
