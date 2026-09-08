import { Header } from '../components/layout/Header';
import { AuditLogViewer } from '../components/dashboard/AuditLogViewer';
import { AuditChainView } from '../components/dashboard/AuditChainView';

export function Audit(): JSX.Element {
  return (
    <div className="ag-page-enter">
      <Header
        title="Audit"
        subtitle="Every tool call · every decision · every hash · with chain verification"
      />
      <main className="p-lg space-y-lg">
        <AuditChainView limit={6} />
        <AuditLogViewer />
      </main>
    </div>
  );
}

export default Audit;