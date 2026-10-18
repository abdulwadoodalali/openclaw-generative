// Chat lives next to Home in one pager now. This route stays for deep links and old links: it brings
// the chat page forward and goes to Home, where the pager is.
import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { showChat } from '../lib/pager';

export default function Chat() {
  useEffect(() => {
    showChat();
  }, []);
  return <Redirect href="/" />;
}
