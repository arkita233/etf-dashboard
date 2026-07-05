import { Link, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { EtfList } from './pages/EtfList';
import { EtfDetail } from './pages/EtfDetail';

/**
 * Root app: routes + minimal top nav.
 *
 * Top nav intentionally does NOT include an "Add ETF" button — config lives
 * only in etfs.yaml/etfs.json, edited via file.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/etfs" element={<EtfList />} />
        <Route path="/etfs/:code" element={<EtfDetail />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function Layout() {
  const loc = useLocation();
  return (
    <div className="app">
      <header className="top-nav">
        <div className="brand">📈 ETF 份额追踪</div>
        <nav className="nav-links">
          <Link className={loc.pathname === '/' ? 'active' : ''} to="/">
            首页
          </Link>
          <Link className={loc.pathname.startsWith('/etfs') ? 'active' : ''} to="/etfs">
            ETF 列表
          </Link>
        </nav>
      </header>
      <main className="page">
        <Outlet />
      </main>
      <footer className="footer">
        数据来源：公开渠道（仅供学习使用） · 配置驱动 · 静态部署
      </footer>
    </div>
  );
}

function NotFound() {
  return (
    <div style={{ padding: '2rem', color: '#475569' }}>
      404 - 页面不存在。
    </div>
  );
}