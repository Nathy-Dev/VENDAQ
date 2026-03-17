"use client";

import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export function useVENDAQActions() {
  const createOrUpdateBusiness = useMutation(api.businesses.createOrUpdateBusiness);
  const updateStatus = useMutation(api.businesses.updateConnectionStatus);

  return {
    createOrUpdateBusiness,
    updateStatus
  };
}
