import { useLocalSearchParams } from 'expo-router';
import { CanvasScreen } from '../../screens/CanvasScreen';

export default function CanvasRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CanvasScreen id={Array.isArray(id) ? id[0] : id} />;
}
