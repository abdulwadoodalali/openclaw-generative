import '../polyfills';
import '../../global.css';
import '../pressableStyles';
import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { AnoProvider } from '../state/AnoProvider';
import { CanvasToolRenderer } from '../canvas/CanvasToolRenderer';
import { GenUiRegistrar } from '../genui/GenUiRegistrar';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <AnoProvider>
          <StatusBar style="dark" />
          <GenUiRegistrar />
          <CanvasToolRenderer />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
        </AnoProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
