import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './AdminDashboard.css';

interface ValidationResult {
  isValid: boolean;
  reason: string;
  confidence: number;
}

interface InvestigationResult {
  ruleViolations: { rule: string; description: string; severity: string }[];
  suspectedFunction: string;
  explanation: string;
  suggestedFix: string;
}

interface Report {
  id: string;
  status: string;
  category: string;
  description: string;
  player: string;
  timestamp: string;
  validationResult?: ValidationResult;
  investigationResult?: InvestigationResult;
  gameSnapshot?: Record<string, unknown>;
}

interface Violation {
  rule: string;
  description: string;
}

interface SimulationResult {
  id: string;
  passed: boolean;
  violations: Violation[];
  timestamp: string;
  gameState?: Record<string, unknown>;
}

interface DashboardStats {
  totalReports: number;
  invalidReports: number;
  needsInvestigation: number;
  confirmedBugs: number;
  simulationsPassed: number;
  simulationsFailed: number;
}

function getBaseUrl(): string {
  const port = window.location.port;
  // Dev servers run on non-3001 ports; route API calls to the backend
  if (port && port !== '3001') {
    return 'http://localhost:3001';
  }
  return '';
}

const STATUS_COLORS: Record<string, string> = {
  invalid: '#ef4444',
  needs_investigation: '#eab308',
  confirmed: '#f97316',
  resolved: '#10b981',
  pending: '#6b7280',
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

export const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [simulations, setSimulations] = useState<SimulationResult[]>([]);
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [expandedSim, setExpandedSim] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [runningSimulation, setRunningSimulation] = useState(false);

  const baseUrl = getBaseUrl();

  const fetchAllData = async () => {
    setLoading(true);
    setError('');
    try {
      const [statsRes, reportsRes, simsRes] = await Promise.all([
        fetch(`${baseUrl}/api/admin/dashboard`),
        fetch(`${baseUrl}/api/reports`),
        fetch(`${baseUrl}/api/simulations`),
      ]);

      if (!statsRes.ok || !reportsRes.ok || !simsRes.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      const [statsData, reportsData, simsData] = await Promise.all([
        statsRes.json() as Promise<DashboardStats>,
        reportsRes.json() as Promise<Report[]>,
        simsRes.json() as Promise<SimulationResult[]>,
      ]);

      setStats(statsData);
      setReports(reportsData);
      setSimulations(simsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRunSimulation = async () => {
    setRunningSimulation(true);
    try {
      const res = await fetch(`${baseUrl}/api/simulations/run`, { method: 'POST' });
      if (!res.ok) throw new Error('Simulation request failed');
      await fetchAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation error');
    } finally {
      setRunningSimulation(false);
    }
  };

  const toggleReport = (id: string) => {
    setExpandedReport(prev => (prev === id ? null : id));
  };

  const toggleSim = (id: string) => {
    setExpandedSim(prev => (prev === id ? null : id));
  };

  if (loading) {
    return (
      <div className="admin-dashboard">
        <div className="admin-container">
          <p className="admin-loading">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <div className="admin-container">
        {/* Header */}
        <header className="admin-header">
          <h1>🔧 Truco Admin Dashboard</h1>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>
            ← Back to Home
          </button>
        </header>

        {error && <div className="admin-error">{error}</div>}

        {/* Summary Cards */}
        {stats && (
          <section className="summary-grid">
            <div className="summary-card glass-panel">
              <span className="card-value">{stats.totalReports}</span>
              <span className="card-label">Total Reports</span>
            </div>
            <div className="summary-card glass-panel">
              <span className="card-value" style={{ color: STATUS_COLORS.invalid }}>
                {stats.invalidReports}
              </span>
              <span className="card-label">Invalid Reports</span>
            </div>
            <div className="summary-card glass-panel">
              <span className="card-value" style={{ color: STATUS_COLORS.needs_investigation }}>
                {stats.needsInvestigation}
              </span>
              <span className="card-label">Needs Investigation</span>
            </div>
            <div className="summary-card glass-panel">
              <span className="card-value" style={{ color: STATUS_COLORS.confirmed }}>
                {stats.confirmedBugs}
              </span>
              <span className="card-label">Confirmed Bugs</span>
            </div>
            <div className="summary-card glass-panel">
              <span className="card-value" style={{ color: '#10b981' }}>
                {stats.simulationsPassed}
              </span>
              <span className="card-label">Simulations Passed</span>
            </div>
            <div className="summary-card glass-panel">
              <span className="card-value" style={{ color: '#ef4444' }}>
                {stats.simulationsFailed}
              </span>
              <span className="card-label">Simulations Failed</span>
            </div>
          </section>
        )}

        {/* Action Buttons */}
        <div className="admin-actions">
          <button
            className="btn btn-primary"
            onClick={handleRunSimulation}
            disabled={runningSimulation}
          >
            {runningSimulation ? 'Running…' : '▶ Run Simulation'}
          </button>
          <button className="btn btn-secondary" onClick={fetchAllData}>
            🔄 Refresh
          </button>
        </div>

        {/* Reports Table */}
        <section className="admin-section">
          <h2>Bug Reports ({reports.length})</h2>
          {reports.length === 0 ? (
            <p className="admin-empty">No reports yet.</p>
          ) : (
            <div className="table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Status</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Player</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map(report => (
                    <React.Fragment key={report.id}>
                      <tr
                        className="clickable-row"
                        onClick={() => toggleReport(report.id)}
                      >
                        <td className="mono">{truncate(report.id, 8)}</td>
                        <td>
                          <span
                            className="status-badge"
                            style={{ backgroundColor: STATUS_COLORS[report.status] || '#6b7280' }}
                          >
                            {report.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td>{report.category}</td>
                        <td>{truncate(report.description, 60)}</td>
                        <td>{report.player}</td>
                        <td>{new Date(report.timestamp).toLocaleString()}</td>
                      </tr>
                      {expandedReport === report.id && (
                        <tr className="expanded-row">
                          <td colSpan={6}>
                            <div className="expanded-content">
                              <div className="detail-group">
                                <h4>Full Description</h4>
                                <p>{report.description}</p>
                              </div>

                              {report.validationResult && (
                                <div className="detail-group">
                                  <h4>Validation Result</h4>
                                  <ul>
                                    <li>
                                      <strong>Valid:</strong>{' '}
                                      {report.validationResult.isValid ? '✅ Yes' : '❌ No'}
                                    </li>
                                    <li>
                                      <strong>Reason:</strong> {report.validationResult.reason}
                                    </li>
                                    <li>
                                      <strong>Confidence:</strong>{' '}
                                      {(report.validationResult.confidence * 100).toFixed(0)}%
                                    </li>
                                  </ul>
                                </div>
                              )}

                              {report.investigationResult && (
                                <div className="detail-group">
                                  <h4>Investigation Result</h4>
                                  <ul>
                                    <li>
                                      <strong>Violations:</strong>{' '}
                                      {report.investigationResult.ruleViolations.length > 0
                                        ? report.investigationResult.ruleViolations
                                            .map(v => `${v.rule} (${v.severity}): ${v.description}`)
                                            .join('; ')
                                        : 'None'}
                                    </li>
                                    <li>
                                      <strong>Suspected Function:</strong>{' '}
                                      <code>{report.investigationResult.suspectedFunction}</code>
                                    </li>
                                    <li>
                                      <strong>Explanation:</strong>{' '}
                                      {report.investigationResult.explanation}
                                    </li>
                                    <li>
                                      <strong>Suggested Fix:</strong>{' '}
                                      {report.investigationResult.suggestedFix}
                                    </li>
                                  </ul>
                                </div>
                              )}

                              {report.gameSnapshot && (
                                <div className="detail-group">
                                  <h4>Game Snapshot</h4>
                                  <pre className="json-dump">
                                    {JSON.stringify(report.gameSnapshot, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Simulations Table */}
        <section className="admin-section">
          <h2>Simulation Results ({simulations.length})</h2>
          {simulations.length === 0 ? (
            <p className="admin-empty">No simulation results yet.</p>
          ) : (
            <div className="table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Result</th>
                    <th>Violations</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {simulations.map(sim => (
                    <React.Fragment key={sim.id}>
                      <tr
                        className="clickable-row"
                        onClick={() => toggleSim(sim.id)}
                      >
                        <td className="mono">{truncate(sim.id, 8)}</td>
                        <td>
                          <span
                            className="status-badge"
                            style={{
                              backgroundColor: sim.passed ? '#10b981' : '#ef4444',
                            }}
                          >
                            {sim.passed ? 'Passed' : 'Failed'}
                          </span>
                        </td>
                        <td>{sim.violations.length}</td>
                        <td>{new Date(sim.timestamp).toLocaleString()}</td>
                      </tr>
                      {expandedSim === sim.id && (
                        <tr className="expanded-row">
                          <td colSpan={4}>
                            <div className="expanded-content">
                              {sim.violations.length > 0 && (
                                <div className="detail-group">
                                  <h4>Violations</h4>
                                  <ul>
                                    {sim.violations.map((v, i) => (
                                      <li key={i}>
                                        <strong>{v.rule}:</strong> {v.description}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {sim.gameState && (
                                <div className="detail-group">
                                  <h4>Game State Dump</h4>
                                  <pre className="json-dump">
                                    {JSON.stringify(sim.gameState, null, 2)}
                                  </pre>
                                </div>
                              )}

                              {sim.violations.length === 0 && !sim.gameState && (
                                <p className="admin-empty">No additional details.</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
