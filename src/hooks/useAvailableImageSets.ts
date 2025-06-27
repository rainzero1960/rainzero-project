import { useState, useEffect } from 'react';
import { authenticatedFetch } from '@/lib/utils';

interface ImageSet {
  image_set: string;
  preview_images: {
    [key: string]: string;
  };
}

interface ThemeImageSets {
  theme_name: string;
  theme_number: number;
  available_sets: ImageSet[];
}

interface AvailableImageSetsData {
  light_theme: ThemeImageSets;
  dark_theme: ThemeImageSets;
  common_available_sets: ImageSet[];
}

interface UseAvailableImageSetsResult {
  imageSets: AvailableImageSetsData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * 利用可能な背景画像セットを取得するフック
 */
export function useAvailableImageSets(): UseAvailableImageSetsResult {
  const [imageSets, setImageSets] = useState<AvailableImageSetsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchImageSets = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await authenticatedFetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/available-image-sets`,
        { method: 'GET' }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch image sets: ${response.statusText}`);
      }

      const data = await response.json();
      setImageSets(data);
    } catch (err) {
      console.error('Error fetching available image sets:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchImageSets();
  }, []);

  return {
    imageSets,
    isLoading,
    error,
    refetch: fetchImageSets,
  };
}