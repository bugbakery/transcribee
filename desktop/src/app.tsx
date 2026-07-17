import { Route, Router } from 'wouter';
import { ModalHolder } from 'transcribee-ui-common/components/modal';
import { HomePage } from './pages/home';
import { DocumentPage } from './pages/document';

function App() {
  return (
    <Router>
      <ModalHolder />
      <Route path="/" component={HomePage} />
      <Route path="/document/*" component={DocumentPage} />
    </Router>
  );
}

export default App;
