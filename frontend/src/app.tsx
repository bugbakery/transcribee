import { Redirect, Route, Router, Switch, useLocation } from 'wouter';

import { trimTrailingSlash } from './utils/trim_trailing_slash';
import { LoginPage } from './pages/login';
import { UserHomePage } from './pages/user_home';
import { NewDocumentPage } from './pages/new_document';
import { DocumentPage } from './pages/document';
import { PageNotFoundPage } from './pages/page_not_found';
import { ModalHolder } from './components/modal';
import { useAuthData } from './utils/auth';
import { LoadingPage } from './pages/loading';

export function App() {
  const routerBase = trimTrailingSlash(import.meta.env.BASE_URL);

  const [_location, navigate] = useLocation();
  const { isLoading, isLoggedIn, hasShareToken } = useAuthData();
  const isAuthenticated = isLoggedIn || hasShareToken;
  if (!isAuthenticated && !isLoading) {
    setTimeout(() => navigate('/login'), 0);
  }

  return (
    <Router base={routerBase}>
      <ModalHolder />
      <Switch>
        <Route path="/login" component={LoginPage} />

        {isLoggedIn && (
          <>
            <Route path="/" component={UserHomePage} />
            <Route path="/new" component={NewDocumentPage} />
            <Route path="/document/:documentId" component={DocumentPage} />
          </>
        )}
        {hasShareToken && (
          <>
            <Route path="/document/:documentId" component={DocumentPage} />
            <Route>
              <Redirect to="/login" />
            </Route>
          </>
        )}
        {isLoading && <Route component={LoadingPage} />}
        <Route component={PageNotFoundPage} />
      </Switch>
    </Router>
  );
}
