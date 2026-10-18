// Picks photos for the composer with expo-image-picker (base64, quality 0.6, no editing). The picker
// cannot resize, so a photo whose base64 is over 6 MB is left out with a quiet note.
import * as ImagePicker from 'expo-image-picker';
import type { PickedImage } from '../../state/AnoProvider';

export const MAX_IMAGES = 4;
const MAX_BASE64_CHARS = 6 * 1024 * 1024;

export type PickResult = { images: PickedImage[]; note: string | null };

const OPTIONS = { mediaTypes: ['images'] as ImagePicker.MediaType[], base64: true, quality: 0.6, allowsEditing: false };

function toPicked(asset: ImagePicker.ImagePickerAsset, index: number): PickedImage | null {
  if (!asset.base64) return null;
  const mimeType = asset.mimeType ?? 'image/jpeg';
  const extension = mimeType.split('/')[1] ?? 'jpg';
  return {
    uri: asset.uri,
    base64: asset.base64,
    mimeType,
    width: asset.width,
    height: asset.height,
    fileName: asset.fileName ?? `photo-${Date.now()}-${index}.${extension}`,
  };
}

/** `room` is how many more photos fit (at most MAX_IMAGES in total). */
export async function pickImages(source: 'library' | 'camera', room: number): Promise<PickResult> {
  if (room <= 0) return { images: [], note: `Up to ${MAX_IMAGES} photos per message` };
  try {
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return { images: [], note: 'Allow camera access in Settings to take a photo' };
      result = await ImagePicker.launchCameraAsync(OPTIONS);
    } else {
      result = await ImagePicker.launchImageLibraryAsync({ ...OPTIONS, allowsMultipleSelection: true, selectionLimit: room });
    }
    if (result.canceled) return { images: [], note: null };
    const picked = result.assets.map(toPicked).filter((image): image is PickedImage => image !== null);
    const fits = picked.filter((image) => image.base64.length <= MAX_BASE64_CHARS).slice(0, room);
    const note = fits.length < picked.length ? 'A photo was too large to attach' : null;
    return { images: fits, note };
  } catch {
    return { images: [], note: source === 'camera' ? 'The camera is not available' : 'Could not open your photos' };
  }
}
