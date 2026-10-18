// NativeWind wraps every Pressable on iOS and Android, and that wrapper flattens the prop
// `style={({ pressed }) => ...}` into an empty object (it spreads the function), so the button
// loses all of its layout: the send button vanished, the brain chip stacked its arrow under the
// label, and the sidebar rows collapsed. https://github.com/nativewind/nativewind/issues/1105
//
// No Pressable in the app uses `className`, so Pressable is re-registered with `remapProps`, which
// only turns a `className` string into a style and passes every other prop (a style function too)
// through untouched. NativeWind registers its own wrapper the first time JSX renders, so that file is
// loaded first and then replaced; this module must be imported before anything renders.
// The web build has no such wrapper and needs nothing.
import { Platform, Pressable } from 'react-native';
import { remapProps } from 'react-native-css-interop';

if (Platform.OS !== 'web') {
  require('react-native-css-interop/dist/runtime/components');
  remapProps(Pressable, { className: 'style' });
}
