import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { SiteList } from './pages/SiteList';
import { SiteEditor } from './pages/SiteEditor';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"                     element={<SiteList />} />
        <Route path="/site/:siteId"         element={<SiteEditor />} />
        <Route path="*"                     element={<SiteList />} />
      </Routes>
    </BrowserRouter>
  );
}
