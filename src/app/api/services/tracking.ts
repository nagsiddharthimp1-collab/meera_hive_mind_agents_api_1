import { PricingModalSource } from '@/types/pricing';
import { api } from '../client';
import { API_ENDPOINTS } from '../config';

export const trackingService = {
  async trackModalOpen(source: PricingModalSource) {
    try {
      await api.post(API_ENDPOINTS.TRACKING.MODAL, { source });
    } catch (error) {
      console.error('Tracking modal open failed:', error);
    }
  },
};
