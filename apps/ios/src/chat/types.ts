// Shared chat types. Pure (no react / react-native / expo imports).

/** An image the user attached in the composer (expo-image-picker with base64: true). */
export type PickedImage = {
  /** Local file or blob uri, used for thumbnails. */
  uri: string;
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  fileName: string;
};
