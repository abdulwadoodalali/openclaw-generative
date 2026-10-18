// Haptics that never throw (web and simulators have none).
import * as Haptics from 'expo-haptics';

const quiet = (p: Promise<void>) => p.catch(() => undefined);

export const tapLight = () => quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
export const tapMedium = () => quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
export const tapSelection = () => quiet(Haptics.selectionAsync());
export const tapSuccess = () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
