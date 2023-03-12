import { Route, Router, Switch } from 'wouter';

import DocumentPage from './pages/DocumentPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NewDocumentPage from './pages/NewDocumentPage';
import PageNotFoundPage from './pages/PageNotFoundPage';
import trimTrailingSlash from './utils/trimTrailingSlash';

export default function App() {
  const baseUrl = import.meta.env.BASE_URL as string;

  return (
    <Router base={trimTrailingSlash(baseUrl)}>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/login" component={LoginPage} />
        <Route path="/new" component={NewDocumentPage} />
        <Route path="/document/:documentId" component={DocumentPage} />
        <Route component={PageNotFoundPage} />
      </Switch>
    </Router>
  );
}
