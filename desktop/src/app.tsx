import { Route, Router } from 'wouter';
import { ModalHolder } from 'transcribee-ui-common/components/modal';
import { HomePage } from './pages/home';

function App() {
  return (
    <Router>
      <ModalHolder />
      <Route path="/" component={HomePage} />
    </Router>
  );
}

export default App;
