export interface HorsePlaceholderPhoto {
  id: string;
  src: string;
  width: number;
  height: number;
  aspectRatio: "4:5";
  coat: string;
  scene: string;
  note: string;
  tags: readonly string[];
}

export interface SharedFrontendAssets {
  horsePlaceholders: readonly HorsePlaceholderPhoto[];
  horsePlaceholderFor: (key: string | number, variant?: number) => HorsePlaceholderPhoto;
  horsePlaceholderBatch: (keys: readonly (string | number)[], context?: string) => HorsePlaceholderPhoto[];
  horsePlaceholderManifestUrl: string;
}
