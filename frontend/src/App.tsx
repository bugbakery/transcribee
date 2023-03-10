import { Route } from 'wouter';

import DocumentPage from './pages/DocumentPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';

export default function App() {
  return (
    <div>
      <Route path="/" component={HomePage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/document" component={DocumentPage} />
    </div>
  );
}
