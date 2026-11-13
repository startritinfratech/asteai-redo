'use client';

import useSWR from 'swr';
import type { AdminStats } from '@asteai/types';
import { fetcher } from '@/lib/api';
import { Empty, Eyebrow, KPI, Panel, Tag } from '@/components/ui';
import styles from './admin.module.css';

export default function AdminPage() {
  const { data, error, isLoading } = useSWR<AdminStats>('/admin/stats', fetcher);

  return (
    <div className={styles.page}>
      <Eyebrow>Admin</Eyebrow>
      <h1>Master Control</h1>

      {isLoading && <Empty message="Loading…" />}
      {error && <Empty message={error.message} />}

      {data && (
        <>
          <div className={styles.kpis}>
            <Panel><KPI value={data.totalTenants} label="Tenants" /></Panel>
            {data.usersByRole.map((r) => (
              <Panel key={r.role}><KPI value={r.count} label={r.role} /></Panel>
            ))}
          </div>

          <div className={styles.grids}>
            <Panel>
              <Eyebrow>Requisitions by status</Eyebrow>
              <table className={styles.table}>
                <tbody>
                  {data.reqs.map((r) => (
                    <tr key={r.status}>
                      <td><Tag>{r.status}</Tag></td>
                      <td>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel>
              <Eyebrow>Applications by stage</Eyebrow>
              <table className={styles.table}>
                <tbody>
                  {data.applications.map((a) => (
                    <tr key={a.stage}>
                      <td>{a.stage}</td>
                      <td>{a.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
