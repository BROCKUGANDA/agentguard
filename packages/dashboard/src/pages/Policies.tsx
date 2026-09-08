import { Header } from '../components/layout/Header';
import { PolicyViewer } from '../components/dashboard/PolicyViewer';

export function Policies(): JSX.Element {
  return (
    <div className="ag-page-enter">
      <Header
        title="Policies"
        subtitle="Current YAML in effect · reload from disk · audit version history"
      />
      <main className="p-lg">
        <PolicyViewer showHistory />
      </main>
    </div>
  );
}

export default Policies;