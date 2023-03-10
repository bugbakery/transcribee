import { Route, Switch } from 'wouter';

import DocumentPage from './pages/DocumentPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NewDocumentPage from './pages/NewDocumentPage';
import PageNotFoundPage from './pages/PageNotFoundPage';

export default function App() {
  return (
    <div>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/login" component={LoginPage} />
        <Route path="/new" component={NewDocumentPage} />
        <Route path="/document" component={DocumentPage} />
        <Route component={PageNotFoundPage} />
      </Switch>
    </div>
  );
}
