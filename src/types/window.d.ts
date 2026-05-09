declare global {
  interface Window {
    __splash?: {
      setProgress(value: number): void;
      hide(): void;
    };
  }
}

export {};
