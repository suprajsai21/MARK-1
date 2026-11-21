export interface SecretStore {
  getGeminiKey(): Promise<string | null>;
  setGeminiKey(key: string): Promise<void>;
  hasGeminiKey(): Promise<boolean>;
  deleteGeminiKey(): Promise<void>;
}
