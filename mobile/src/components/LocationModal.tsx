import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LocationProfile } from '../types';
import { LocationService } from '../core/LocationService';
import { X, MapPin, Check, Plus, Trash2 } from 'lucide-react-native';

interface LocationModalProps {
  visible: boolean;
  activeLocation: LocationProfile;
  onClose: () => void;
  onSelectLocation: (loc: LocationProfile) => void;
}

export const LocationModal: React.FC<LocationModalProps> = ({
  visible,
  activeLocation,
  onClose,
  onSelectLocation
}) => {
  const [profiles, setProfiles] = useState<LocationProfile[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [cityName, setCityName] = useState('');
  const [pincode, setPincode] = useState('');

  useEffect(() => {
    if (visible) {
      loadProfiles();
    }
  }, [visible]);

  const loadProfiles = async () => {
    const list = await LocationService.getProfiles();
    setProfiles(list);
  };

  const handleSelect = async (loc: LocationProfile) => {
    await LocationService.setActiveLocation(loc);
    onSelectLocation(loc);
    onClose();
  };

  const handleAddCustom = async () => {
    if (!cityName.trim() || !pincode.trim()) return;

    const newLoc: LocationProfile = {
      id: `custom_${Date.now()}`,
      name: cityName.trim(),
      pincode: pincode.trim(),
      lat: 17.385,
      lng: 78.4867,
      address: `${cityName.trim()} (${pincode.trim()})`
    };

    const updated = await LocationService.addProfile(newLoc);
    setProfiles(updated);
    setCityName('');
    setPincode('');
    setIsAdding(false);
    handleSelect(newLoc);
  };

  const handleDelete = async (id: string) => {
    const updated = await LocationService.deleteProfile(id);
    setProfiles(updated);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <MapPin size={18} color="#10B981" />
              <Text style={styles.title}>Saved Locations</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Location List */}
          <FlatList
            data={profiles}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContainer}
            renderItem={({ item }) => {
              const isSelected = item.id === activeLocation.id;
              return (
                <TouchableOpacity
                  style={[styles.profileCard, isSelected && styles.activeProfileCard]}
                  onPress={() => handleSelect(item)}
                >
                  <View style={styles.profileInfo}>
                    <Text style={styles.profileName}>{item.name}</Text>
                    <Text style={styles.profilePincode}>Pincode: {item.pincode}</Text>
                  </View>

                  <View style={styles.profileActions}>
                    {isSelected ? (
                      <View style={styles.checkBadge}>
                        <Check size={14} color="#10B981" />
                      </View>
                    ) : (
                      !item.isDefault && (
                        <TouchableOpacity
                          onPress={() => handleDelete(item.id)}
                          style={styles.deleteBtn}
                        >
                          <Trash2 size={16} color="#EF4444" />
                        </TouchableOpacity>
                      )
                    )}
                  </View>
                </TouchableOpacity>
              );
            }}
          />

          {/* Add Custom Location Form */}
          {isAdding ? (
            <View style={styles.addForm}>
              <Text style={styles.addFormTitle}>Add New Location</Text>
              <TextInput
                style={styles.input}
                placeholder="City / Area (e.g. Pune Kothrud)"
                placeholderTextColor="#64748B"
                value={cityName}
                onChangeText={setCityName}
              />
              <TextInput
                style={styles.input}
                placeholder="6-digit Pincode (e.g. 411038)"
                placeholderTextColor="#64748B"
                keyboardType="numeric"
                maxLength={6}
                value={pincode}
                onChangeText={setPincode}
              />
              <View style={styles.formButtonRow}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setIsAdding(false)}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleAddCustom}
                >
                  <Text style={styles.saveBtnText}>Save Location</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.addLocationBtn}
              onPress={() => setIsAdding(true)}
            >
              <Plus size={16} color="#38BDF8" />
              <Text style={styles.addLocationBtnText}>Add Custom Location</Text>
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    justifyContent: 'flex-end'
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 20
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155'
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  title: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700'
  },
  closeBtn: {
    padding: 4
  },
  listContainer: {
    padding: 16,
    gap: 10
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  activeProfileCard: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.08)'
  },
  profileInfo: {
    flex: 1
  },
  profileName: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600'
  },
  profilePincode: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2
  },
  profileActions: {
    marginLeft: 12
  },
  checkBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  deleteBtn: {
    padding: 6
  },
  addLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    backgroundColor: 'rgba(56, 189, 248, 0.08)'
  },
  addLocationBtnText: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '700'
  },
  addForm: {
    marginHorizontal: 16,
    padding: 14,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  addFormTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10
  },
  input: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 10,
    color: '#F8FAFC',
    fontSize: 13,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  formButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14
  },
  cancelBtnText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600'
  },
  saveBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8
  },
  saveBtnText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '800'
  }
});
