import { Route } from 'wouter';

import DocumentPage from './pages/DocumentPage';
import HomePage from './pages/HomePage';

export default function App() {
  return (
    <div>
      <Route path="/" component={HomePage} />
      <Route path="/document" component={DocumentPage} />
    </div>
  );
}
