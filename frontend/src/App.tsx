import { Route, Router, Switch, useLocation } from 'wouter';

import DocumentPage from './pages/DocumentPage';
import UserHomePage from './pages/UserHomePage';
import LoginPage from './pages/LoginPage';
import NewDocumentPage from './pages/NewDocumentPage';
import PageNotFoundPage from './pages/PageNotFoundPage';
import trimTrailingSlash from './utils/trimTrailingSlash';
import { useGetMe } from './api/user';

export default function App() {
  const routerBase = trimTrailingSlash(import.meta.env.BASE_URL);

  const [_location, navigate] = useLocation();
  const { data, isLoading } = useGetMe({});
  const isLoggedIn = data?.username;
  console.log('isLoggedIn', isLoggedIn, data);
  if (!isLoggedIn && !isLoading) {
    setTimeout(() => navigate('/login'), 0);
  }

  return (
    <Router base={routerBase}>
      <Switch>
        <Route path="/login" component={LoginPage} />

        {isLoggedIn && (
          <>
            <Route path="/" component={UserHomePage} />
            <Route path="/new" component={NewDocumentPage} />
            <Route path="/document/:documentId" component={DocumentPage} />
            <Route component={PageNotFoundPage} />
          </>
        )}
      </Switch>
    </Router>
  );
}
