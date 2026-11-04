import { CodeFlowProvider } from './state/CodeFlowProvider';
import { useCodeFlow } from './state/useCodeFlow';
import { Dashboard } from './components/Dashboard/Dashboard';
import { ReviewLayout } from './components/Layout/Layout';
import { OpeningSplash } from './components/OpeningSplash/OpeningSplash';
import { openingSplashTarget } from './components/OpeningSplash/splashTarget';
import { SetupRequired } from './components/SetupRequired/SetupRequired';
import { useDeepLinkPending } from './state/hooks/useDeepLink';
import { redirectToPlayerIfTopLevel } from './utils/deepLink';
import { isGitHubConnectorConfigured } from './connectors/github';
import './App.css';

// A deep link opened outside the player has no connector context, so bounce to
// the player (carrying the link) before rendering anything.
const redirecting = redirectToPlayerIfTopLevel();

function Shell() {
  const { status, pr, pendingPr } = useCodeFlow();
  const pendingDeepLink = useDeepLinkPending(status);
  // Opening a PR from the dashboard gets the same splash, so the click reads as
  // "on it" rather than leaving the reviewer staring at an unchanged dashboard.
  const opening = openingSplashTarget(status, pendingPr, !!pr);
  const content = pendingDeepLink ? <OpeningSplash target={pendingDeepLink} />
    : opening ? <OpeningSplash target={opening} />
    : status === 'ready' ? <ReviewLayout />
    : <Dashboard />;
  return <div className="app-surface">{content}</div>;
}

export default function App() {
  if (redirecting) {
    return <OpeningSplash target={null} />;
  }
  if (!isGitHubConnectorConfigured()) {
    return <SetupRequired />;
  }
  return (
    <CodeFlowProvider>
      <Shell />
    </CodeFlowProvider>
  );
}
