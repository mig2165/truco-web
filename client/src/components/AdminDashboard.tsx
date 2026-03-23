import React, { useState, useEffect, useCallback } from 'react';
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
  playerName?: string;
  timestamp: string;
  validationResult?: ValidationResult;
  investigationResult?: InvestigationResult;
  gameSnapshot?: Record<string, unknown>;
  fixId?: string;
  prId?: string;
  prUrl?: string;
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

interface FixRecord {
  id: string;
  reportId: string;
  timestamp: number;
  generatedPatch: string;
  targetFile: string;
  explanation: string;
  confidence: number;
  status: string;
}

interface PullRequestRecord {
  id: string;
  reportId: string;
  fixId: string;
  timestamp: number;
  branchName: string;
  prNumber?: number;
  prUrl?: string;
  status: string;
  errorMessage?: string;
}

interface BugfixStats {
  totalReports: number;
  pendingReports: number;
  confirmedBugs: number;
  fixesGenerated: number;
  fixesSucceeded: number;
  prsCreated: number;
  prsSucceeded: number;
  skipped: number;
  resolved: number;
  autoFixRate: string;
}

interface BugfixDashboard {
  reports: Report[];
  fixes: FixRecord[];
  prs: PullRequestRecord[];
  stats: BugfixStats;
}

interface TimelineEvent {
  timestamp: number;
  event: string;
  detail: string;
}

interface ReportTimeline {
  report: Report;
  investigation: InvestigationResult | null;
  fix: FixRecord | null;
  pr: PullRequestRecord | null;
  timeline: TimelineEvent[];
}

function getBaseUrl(): string {
  const port = window.location.port;
  if (port && port !== '3001') {
    return 'http://localhost:3001';
  }
  return '';
}

const STATUS_COLORS: Record<string, string> = {
  invalid: '#ef4444',
  needs_investigation: '#eab308',
  confirmed: '#f97316',
  fix_generated: '#8b5cf6',
  pr_created: '#3b82f6',
  skipped: '#6b7280',
  resolved: '#10b981',
  pending: '#6b7280',
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

const FIX_STATUS_COLORS: Record<string, string> = {
  generated: '#8b5cf6',
  applied: '#10b981',
  failed: '#ef4444',
  skipped: '#6b7280',
};

const PR_STATUS_COLORS: Record<string, string> = {
  created: '#10b981',
  merged: '#10b981',
  failed: '#ef4444',
  closed: '#6b7280',
};

export const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [simulations, setSimulations] = useState<SimulationResult[]>([]);
  const [bugfixDashboard, setBugfixDashboard] = useState<BugfixDashboard | null>(null);
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [expandedSim, setExpandedSim] = useState<string | null>(null);
  const [selectedTimeline, setSelectedTimeline] = useState<ReportTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [runningSimulation, setRunningSimulation] = useState(false);
  const [generatingFix, setGeneratingFix] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'reports' | 'pipeline'>('reports');

  const baseUrl = getBaseUrl();

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statsRes, reportsRes, simsRes, bugfixRes] = await Promise.all([
        fetch(`${baseUrl}/api/admin/dashboard`),
        fetch(`${baseUrl}/api/reports`),
        fetch(`${baseUrl}/api/simulations`),
        fetch(`${baseUrl}/api/bugfix-dashboard`),
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

      if (bugfixRes.ok) {
        const bugfixData = await bugfixRes.json() as BugfixDashboard;
        setBugfixDashboard(bugfixData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void fetchAllData();
  }, [fetchAllData]);

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

  const handleGenerateFix = async (reportId: string) => {
    setGeneratingFix(reportId);
    try {
      const res = await fetch(`${baseUrl}/api/bugfix/${reportId}/generate-fix`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Fix generation failed');
      }
      await fetchAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fix generation error');
    } finally {
      setGeneratingFix(null);
    }
  };

  const handleSkipReport = async (reportId: string) => {
    try {
      const res = await fetch(`${baseUrl}/api/bugfix/${reportId}/skip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Manually skipped via dashboard' }),
      });
      if (!res.ok) throw new Error('Skip request failed');
      await fetchAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Skip error');
    }
  };

  const handleViewTimeline = async (reportId: string) => {
    try {
      const res = await fetch(`${baseUrl}/api/bugfix/${reportId}/timeline`);
      if (!res.ok) throw new Error('Timeline fetch failed');
      const data = await res.json() as ReportTimeline;
      setSelectedTimeline(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Timeline error');
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

  const bfs = bugfixDashboard?.stats;

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

        {/* Pipeline Stats */}
        {bfs && (
          <section className="summary-grid" style={{ marginTop: '-0.5rem' }}>
            <div className="summary-card glass-panel">
              <span className="card-value" style={{ color: STATUS_COLORS.fix_generated }}>
                {bfs.fixesGenerated}
              </span>
              <span className="card-label">Fixes Generated</span>
            </div>
            <div className="summary-card glass-panel">
              <span className="card-value" style={{ color: STATUS_COLORS.pr_created }}>
                {bfs.prsCreated}
              </span>
              <span className="card-label">PRs Created</span>
            </div>
            <div className="summary-card glass-panel">
              <span className="card-value" style={{ color: STATUS_COLORS.resolved }}>
                {bfs.resolved}
              </span>
              <span className="card-label">Resolved</span>
            </div>
            <div className="summary-card glass-panel">
              <span className="card-value" style={{ color: STATUS_COLORS.skipped }}>
                {bfs.skipped}
              </span>
              <span className="card-label">Skipped</span>
            </div>
            <div className="summary-card glass-panel">
              <span className="card-value" style={{ color: '#f97316' }}>
                {bfs.autoFixRate}
              </span>
              <span className="card-label">Auto-fix Rate</span>
            </div>
            <div className="summary-card glass-panel">
              <span className="card-value" style={{ color: '#94a3b8', fontSize: '1rem', paddingTop: '0.5rem' }}>
                🔄 Auto
              </span>
              <span className="card-label">Pipeline Active</span>
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
          <button className="btn btn-secondary" onClick={() => void fetchAllData()}>
            🔄 Refresh
          </button>
          <button
            className={`btn ${activeTab === 'reports' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('reports')}
          >
            📋 Reports
          </button>
          <button
            className={`btn ${activeTab === 'pipeline' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('pipeline')}
          >
            🤖 Pipeline
          </button>
        </div>

        {/* Timeline Modal */}
        {selectedTimeline && (
          <div className="timeline-overlay" onClick={() => setSelectedTimeline(null)}>
            <div className="timeline-modal" onClick={e => e.stopPropagation()}>
              <div className="timeline-header">
                <h3>📅 Report Timeline</h3>
                <button className="btn btn-secondary btn-sm" onClick={() => setSelectedTimeline(null)}>✕ Close</button>
              </div>
              <div className="timeline-body">
                {selectedTimeline.timeline.map((ev, i) => (
                  <div key={i} className="timeline-event">
                    <div className="timeline-dot" />
                    <div className="timeline-content">
                      <span className="timeline-label">{ev.event.replace(/_/g, ' ').toUpperCase()}</span>
                      <span className="timeline-time">{new Date(ev.timestamp).toLocaleString()}</span>
                      <p className="timeline-detail">{ev.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
              {selectedTimeline.fix && (
                <div className="detail-group" style={{ padding: '1rem' }}>
                  <h4>Generated Patch ({selectedTimeline.fix.targetFile})</h4>
                  <pre className="json-dump">{selectedTimeline.fix.generatedPatch}</pre>
                </div>
              )}
              {selectedTimeline.pr?.prUrl && (
                <div style={{ padding: '0.5rem 1rem 1rem' }}>
                  <a href={selectedTimeline.pr.prUrl} target="_blank" rel="noopener noreferrer" className="pr-link">
                    🔗 View Pull Request
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab: Reports */}
        {activeTab === 'reports' && (
          <>
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
                        <th>Actions</th>
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
                            <td>{report.playerName ?? report.player}</td>
                            <td>{new Date(report.timestamp).toLocaleString()}</td>
                            <td onClick={e => e.stopPropagation()}>
                              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                <button
                                  className="btn btn-xs"
                                  onClick={() => void handleViewTimeline(report.id)}
                                  title="View timeline"
                                >
                                  📅
                                </button>
                                {(report.status === 'needs_investigation' || report.status === 'confirmed') && !report.fixId && (
                                  <button
                                    className="btn btn-xs btn-purple"
                                    disabled={generatingFix === report.id}
                                    onClick={() => void handleGenerateFix(report.id)}
                                    title="Generate fix"
                                  >
                                    {generatingFix === report.id ? '…' : '🔧'}
                                  </button>
                                )}
                                {report.status !== 'skipped' && report.status !== 'resolved' && report.status !== 'invalid' && (
                                  <button
                                    className="btn btn-xs btn-gray"
                                    onClick={() => void handleSkipReport(report.id)}
                                    title="Skip report"
                                  >
                                    ⏭
                                  </button>
                                )}
                                {report.prUrl && (
                                  <a
                                    href={report.prUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-xs btn-blue"
                                    title="View PR"
                                  >
                                    🔗
                                  </a>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expandedReport === report.id && (
                            <tr className="expanded-row">
                              <td colSpan={7}>
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
          </>
        )}

        {/* Tab: Pipeline */}
        {activeTab === 'pipeline' && bugfixDashboard && (
          <>
            {/* Fixes Table */}
            <section className="admin-section">
              <h2>Generated Fixes ({bugfixDashboard.fixes.length})</h2>
              {bugfixDashboard.fixes.length === 0 ? (
                <p className="admin-empty">No fixes generated yet. The pipeline will generate fixes automatically for confirmed bugs every 2 minutes, or you can trigger one manually from the Reports tab.</p>
              ) : (
                <div className="table-wrapper">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Fix ID</th>
                        <th>Report ID</th>
                        <th>Target File</th>
                        <th>Confidence</th>
                        <th>Status</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bugfixDashboard.fixes.map(fix => (
                        <tr key={fix.id}>
                          <td className="mono">{truncate(fix.id, 12)}</td>
                          <td className="mono">{truncate(fix.reportId, 12)}</td>
                          <td className="mono">{fix.targetFile}</td>
                          <td>{(fix.confidence * 100).toFixed(0)}%</td>
                          <td>
                            <span
                              className="status-badge"
                              style={{ backgroundColor: FIX_STATUS_COLORS[fix.status] ?? '#6b7280' }}
                            >
                              {fix.status}
                            </span>
                          </td>
                          <td>{new Date(fix.timestamp).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* PRs Table */}
            <section className="admin-section">
              <h2>Pull Requests ({bugfixDashboard.prs.length})</h2>
              {bugfixDashboard.prs.length === 0 ? (
                <p className="admin-empty">No pull requests created yet. PRs are automatically created every 5 minutes for generated fixes.</p>
              ) : (
                <div className="table-wrapper">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>PR ID</th>
                        <th>Branch</th>
                        <th>Status</th>
                        <th>PR #</th>
                        <th>Link</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bugfixDashboard.prs.map(pr => (
                        <tr key={pr.id}>
                          <td className="mono">{truncate(pr.id, 12)}</td>
                          <td className="mono" style={{ fontSize: '0.75rem' }}>{pr.branchName}</td>
                          <td>
                            <span
                              className="status-badge"
                              style={{ backgroundColor: PR_STATUS_COLORS[pr.status] ?? '#6b7280' }}
                            >
                              {pr.status}
                            </span>
                          </td>
                          <td>{pr.prNumber ?? '—'}</td>
                          <td>
                            {pr.prUrl ? (
                              <a href={pr.prUrl} target="_blank" rel="noopener noreferrer" className="pr-link">🔗 View PR</a>
                            ) : pr.errorMessage ? (
                              <span style={{ color: '#f87171', fontSize: '0.75rem' }}>{truncate(pr.errorMessage, 40)}</span>
                            ) : '—'}
                          </td>
                          <td>{new Date(pr.timestamp).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Pipeline Explanation */}
            <section className="admin-section">
              <h2>🔄 Pipeline Schedule</h2>
              <div className="pipeline-schedule">
                {[
                  { interval: '30s', icon: '🔍', label: 'Investigate pending reports' },
                  { interval: '60s', icon: '✅', label: 'Confirm reports with violations' },
                  { interval: '2m', icon: '🔧', label: 'Generate fixes for confirmed bugs' },
                  { interval: '5m', icon: '📬', label: 'Create PRs for generated fixes' },
                  { interval: '10m', icon: '♻️', label: 'Re-verify all fixes via simulation' },
                ].map(item => (
                  <div key={item.interval} className="pipeline-step">
                    <span className="pipeline-icon">{item.icon}</span>
                    <span className="pipeline-interval">{item.interval}</span>
                    <span className="pipeline-label">{item.label}</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

