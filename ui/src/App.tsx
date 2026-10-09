import { useStudio } from './studio/useStudio';
import Rack from './rack/Rack';

export default function App() {
  return <Rack studio={useStudio()} />;
}
