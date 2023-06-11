import { useGetConfig } from '../api/config';

export function useDebugMode(): boolean {
  const { data: config } = useGetConfig({});
  return config && config.debug_mode;
}
