// Dev-only route /demo: the recorded demo thread. Production builds go back to the chat.
import { Redirect } from 'expo-router';
import { DemoScreen } from '../genui/demo/DemoScreen';

export default function Demo() {
  if (!__DEV__) return <Redirect href="/" />;
  return <DemoScreen />;
}
