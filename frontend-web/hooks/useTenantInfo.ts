"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../lib/api";

export interface TenantInfo {
  name: string | null;
  logo_url: string | null;
  loading: boolean;
  notFound: boolean;
}

export function useTenantInfo(): TenantInfo {
  const [name, setName] = useState<string | null>(null);
  const [logo_url, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    apiClient
      .get("/tenant/info")
      .then((res) => {
        setName(res.data.name);
        if (res.data.logo_url) setLogoUrl(res.data.logo_url);
      })
      .catch((err) => {
        if (err?.response?.status === 404) setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, []);

  return { name, logo_url, loading, notFound };
}
